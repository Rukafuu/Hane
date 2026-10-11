import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { realpathSync, statSync } from 'node:fs';
import { containsPath, createScopeResolver, resolveWorkspaceRoot } from '../workspace-scope.js';
import { assertCapabilityGrants } from '../capabilities.js';

const execute = promisify(execFile);
export class WorkspacePickerError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Scripts are constant: request text and paths are never interpolated into code.
export function nativePickerCommand(kind, platform = process.platform) {
  if (!['file', 'directory'].includes(kind)) throw new WorkspacePickerError(400, 'Escolha arquivo ou pasta.');
  if (platform === 'win32') {
    const dialog = kind === 'file'
      ? "$d = New-Object System.Windows.Forms.OpenFileDialog; $d.Title = 'Escolher arquivo para o Hane'; $d.CheckFileExists = $true; $d.Multiselect = $false; $property = 'FileName'"
      : "$d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = 'Escolher pasta para o Hane'; $d.ShowNewFolderButton = $false; $property = 'SelectedPath'";
    const script = "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); Add-Type -AssemblyName System.Windows.Forms; " + dialog + "; try { if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::WriteLine($d.$property) } } finally { $d.Dispose() }";
    return { command: 'powershell.exe', args: ['-NoProfile', '-STA', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')] };
  }
  if (platform === 'darwin') return { command: 'osascript', args: ['-e', kind === 'file' ? 'POSIX path of (choose file with prompt "Escolher arquivo para o Hane")' : 'POSIX path of (choose folder with prompt "Escolher pasta para o Hane")'] };
  if (platform === 'linux') return { command: 'zenity', args: ['--file-selection', '--title=Escolher para o Hane', ...(kind === 'directory' ? ['--directory'] : [])] };
  throw new WorkspacePickerError(503, 'O seletor do sistema não está disponível neste SO.');
}

export async function pickNativeWorkspace({kind, signal}) {
  const {command, args} = nativePickerCommand(kind);
  try {
    const {stdout} = await execute(command, args, {signal, timeout:120_000, maxBuffer:16_384, windowsHide:true, encoding:'utf8'});
    return stdout.trim() || null;
  } catch (error) {
    if ((process.platform === 'linux' && error.code === 1) || (process.platform === 'darwin' && error.stderr?.includes('(-128)'))) return null;
    if (signal?.aborted) return null;
    throw new WorkspacePickerError(503, process.platform === 'linux' ? 'Não foi possível abrir o seletor. Instale o Zenity e execute o Hane em uma sessão gráfica.' : 'Não foi possível abrir o seletor do sistema. Tente novamente em uma sessão gráfica.');
  }
}

export function workspaceSelection(selected, kind, preferredRoot = null) {
  if (typeof selected !== 'string' || !path.isAbsolute(selected) || /[\r\n\0]/.test(selected)) throw new WorkspacePickerError(400, 'O seletor não retornou um caminho local válido.');
  const target = realpathSync(selected);
  const info = statSync(target);
  if (kind === 'file' ? !info.isFile() : !info.isDirectory()) throw new WorkspacePickerError(400, 'O item selecionado não está disponível.');
  const preferred = preferredRoot ? resolveWorkspaceRoot(preferredRoot) : null;
  const root = preferred && containsPath(preferred, target) ? preferred : kind === 'file' ? path.dirname(target) : target;
  const scope = path.relative(root, target).split(path.sep).join('/') || '.';
  const grants = assertCapabilityGrants([{name:'workspace.read',scope}]);
  const resolver = createScopeResolver({root,grants});
  // Selecting a sensitive directory as the root must not erase its deny policy.
  if (resolver.isSecret(target.replaceAll('\\','/'))) throw new WorkspacePickerError(403, 'Este item está protegido pela política de arquivos sensíveis do Hane.');
  const checked = kind === 'file' ? resolver.check(scope) : resolver.checkDirectory(scope);
  if (!checked.ok) throw new WorkspacePickerError(403, 'Este item não pode ser anexado ao workspace.');
  return {kind, root, scope, name:path.basename(target), path:target};
}

export function createWorkspacePicker({pick = pickNativeWorkspace, defaultRoot, readJsonBody, respondJson}) {
  let busy = false;
  return async ({request,response,isAuthorized}) => {
    if (new URL(request.url,'http://127.0.0.1').pathname !== '/api/workspace/select' || request.method !== 'POST') return false;
    if (!isAuthorized()) { respondJson(response,401,{error:'Desbloqueie o Hane para escolher um item.'}); return true; }
    const body = await readJsonBody(request).catch(()=>null);
    if (!['file','directory'].includes(body?.kind) || (body.root != null && typeof body.root !== 'string')) { respondJson(response,400,{error:'Escolha arquivo ou pasta.'}); return true; }
    if (busy) { respondJson(response,409,{error:'Já existe um seletor aberto. Conclua ou cancele a seleção.'}); return true; }
    busy = true;
    const controller = new AbortController();
    const close = () => { if (!response.writableEnded) controller.abort(); };
    response.on('close',close);
    try {
      const selected = await pick({kind:body.kind,signal:controller.signal});
      if (controller.signal.aborted) return true;
      if (!isAuthorized()) throw new WorkspacePickerError(401,'A sessão foi encerrada. Desbloqueie novamente.');
      respondJson(response,200,selected ? {selection:workspaceSelection(selected,body.kind,body.root ?? defaultRoot)} : {selection:null});
    } catch (error) {
      if (!controller.signal.aborted) respondJson(response,error instanceof WorkspacePickerError ? error.status : 400,{error:error instanceof WorkspacePickerError ? error.message : 'O item selecionado não está mais disponível ou o workspace é inválido.'});
    } finally { busy = false; response.off('close',close); }
    return true;
  };
}
