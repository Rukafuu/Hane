import { useMemo, useState } from "react"

type IconName = "search" | "plus" | "sparkles" | "users" | "chevron" | "settings" | "clock" | "paperclip" | "at" | "send" | "more" | "check" | "code" | "file" | "external" | "monitor" | "crown" | "layout" | "command"

function Icon({ name, size = 16 }: { name: IconName size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
    plus: (
      <>
        <path d="M12 5v14M5 12h14" />
      </>
    ),
    sparkles: (
      <>
        <path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3Z" />
        <path d="m18 14 .7 2.3L21 17l-2.3.7L18 20l-.7-2.3L15 17l2.3-.7L18 14Z" />
      </>
    ),
    users: (
      <>
        <path d="M16 20v-1.5a4.5 4.5 0 0 0-4.5-4.5h-3A4.5 4.5 0 0 0 4 18.5V20" />
        <circle cx="10" cy="7" r="4" />
        <path d="M17 11a3.5 3.5 0 0 1 3 3.5V17M16 3.5a3.5 3.5 0 0 1 0 6.8" />
      </>
    ),
    chevron: <path d="m9 18 6-6-6-6" />,
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1-2.9 2.9-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21H10v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1-2.9-2.9.1-.1a1.6 1.6 0 0 0 .3-1.8A1.6 1.6 0 0 0 3.1 14H3v-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1 2.9-2.9.1.1a1.6 1.6 0 0 0 1.8.3 1.6 1.6 0 0 0 1-1.5V3h4v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1 2.9 2.9-.1.1a1.6 1.6 0 0 0-.3 1.8 1.6 1.6 0 0 0 1.5 1h.1v4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    paperclip: (
      <path d="m20.5 11.5-8.8 8.8a6 6 0 0 1-8.5-8.5l9.1-9.1a4 4 0 0 1 5.7 5.7l-9.1 9.1a2 2 0 0 1-2.8-2.8l8.4-8.4" />
    ),
    at: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.3 7" />
      </>
    ),
    send: (
      <>
        <path d="m22 2-7 20-4-9-9-4 20-7Z" />
        <path d="M22 2 11 13" />
      </>
    ),
    more: (
      <>
        <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
        <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    code: (
      <>
        <path d="m8 9-3 3 3 3M16 9l3 3-3 3M14 5l-4 14" />
      </>
    ),
    file: (
      <>
        <path d="M6 2h8l4 4v16H6z" />
        <path d="M14 2v5h5M9 13h6M9 17h4" />
      </>
    ),
    external: (
      <>
        <path d="M14 4h6v6M20 4l-9 9" />
        <path d="M18 13v6H5V6h6" />
      </>
    ),
    monitor: (
      <>
        <rect x="3" y="4" width="18" height="13" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </>
    ),
    crown: (
      <>
        <path d="m3 7 4 4 5-7 5 7 4-4-2 11H5L3 7Z" />
        <path d="M5 21h14" />
      </>
    ),
    layout: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M9 3v18M9 9h12" />
      </>
    ),
    command: (
      <>
        <path d="M9 6V5a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v14a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6Z" />
      </>
    ),
  }
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
      <path
        className="signature-mark"
        d="M3.2 3.8 5 2l1.8 1.8L5 5.6 3.2 3.8Z"
      />
    </svg>
  )
}

type AgentName = "orion" | "byte" | "nova" | "cipher" | "lumi"

const agents: Record<AgentName, { name: string role: string color: string }> = {
  orion: { name: "Orion", role: "Coordenador", color: "lilac" },
  byte: { name: "Byte", role: "Eng. de software", color: "blue" },
  nova: { name: "Nova", role: "Pesquisadora", color: "peach" },
  cipher: { name: "Cipher", role: "Revisor", color: "mint" },
  lumi: { name: "Lumi", role: "Designer", color: "pink" },
}

function Avatar({
  agent,
  size = "md",
  stacked = false,
}: {
  agent: AgentName
  size?: "sm" | "md" | "lg"
  stacked?: boolean
}) {
  return (
    <div
      className={`avatar avatar-${agents[agent].color} avatar-${size} ${
        stacked ? "avatar-stacked" : ""
      }`}
      aria-label={agents[agent].name}
    >
      <span className={`face face-${agent}`}>
        <i />
        <b />
      </span>
    </div>
  )
}

function AgentStack({
  names = ["orion", "byte", "nova", "cipher"] as AgentName[],
}: {
  names?: AgentName[]
}) {
  return (
    <div className="agent-stack">
      {names.map((name) => (
        <Avatar key={name} agent={name} size="sm" stacked />
      ))}
    </div>
  )
}

const conversations = [
  {
    id: "dev",
    title: "Equipe de Desenvolvimento",
    subtitle: "Orion: A análise foi concluída",
    time: "agora",
    agents: ["orion", "byte", "nova", "cipher"] as AgentName[],
    group: true,
  },
  {
    id: "launch",
    title: "Planejamento do lançamento",
    subtitle: "Nova: Encontrei 3 referências",
    time: "12 min",
    agents: ["nova", "lumi"] as AgentName[],
    group: true,
  },
  {
    id: "site",
    title: "Novo site da Hane",
    subtitle: "Lumi: Atualizei o protótipo",
    time: "1h",
    agents: ["lumi", "byte"] as AgentName[],
    group: true,
  },
]

function Sidebar({
  active,
  onSelect,
}: {
  active: string
  onSelect: (id: string) => void
}) {
  return (
    <aside className="left-sidebar">
      <div className="brand-row">
        <div className="brand">
          hane<span>.</span>
        </div>
        <button className="icon-button" aria-label="Menu">
          <Icon name="more" />
        </button>
      </div>
      <button className="search-box">
        <Icon name="search" />
        <span>Pesquisar</span>
        <kbd>⌘ K</kbd>
      </button>
      <button className="new-chat">
        <span className="new-icon">
          <Icon name="plus" size={15} />
        </span>
        <span>Nova conversa</span>
        <Icon name="chevron" size={14} />
      </button>

      <nav className="sidebar-scroll">
        <div className="section-head">
          <span>AGENTES</span>
          <button aria-label="Adicionar agente">
            <Icon name="plus" size={14} />
          </button>
        </div>
        <button
          className={`nav-person ${active === "orion" ? "selected" : ""}`}
          onClick={() => onSelect("orion")}
        >
          <Avatar agent="orion" size="sm" />
          <span>
            <strong>Orion</strong>
            <small>Coordenador geral</small>
          </span>
          <i className="online" />
        </button>
        <button
          className={`nav-person ${active === "byte" ? "selected" : ""}`}
          onClick={() => onSelect("byte")}
        >
          <Avatar agent="byte" size="sm" />
          <span>
            <strong>Byte</strong>
            <small>Engenharia de software</small>
          </span>
          <i className="online" />
        </button>
        <button
          className={`nav-person ${active === "nova" ? "selected" : ""}`}
          onClick={() => onSelect("nova")}
        >
          <Avatar agent="nova" size="sm" />
          <span>
            <strong>Nova</strong>
            <small>Pesquisa e estratégia</small>
          </span>
        </button>
        <button
          className={`nav-person ${active === "lumi" ? "selected" : ""}`}
          onClick={() => onSelect("lumi")}
        >
          <Avatar agent="lumi" size="sm" />
          <span>
            <strong>Lumi</strong>
            <small>Design de produto</small>
          </span>
          <i className="online" />
        </button>

        <div className="section-head conversation-head">
          <span>CONVERSAS</span>
          <button aria-label="Nova conversa">
            <Icon name="plus" size={14} />
          </button>
        </div>
        {conversations.map((conversation) => (
          <button
            key={conversation.id}
            className={`conversation ${
              active === conversation.id ? "selected" : ""
            }`}
            onClick={() => onSelect(conversation.id)}
          >
            <AgentStack names={conversation.agents} />
            <span className="conversation-copy">
              <span>
                <strong>{conversation.title}</strong>
                <time>{conversation.time}</time>
              </span>
              <small>{conversation.subtitle}</small>
            </span>
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <button>
          <span className="routine-icon">
            <Icon name="clock" />
          </span>
          <span>
            <strong>Rotinas</strong>
            <small>3 ativas esta semana</small>
          </span>
          <Icon name="chevron" size={14} />
        </button>
        <button>
          <span className="settings-icon">
            <Icon name="settings" />
          </span>
          <span>
            <strong>Configurações</strong>
            <small>Equipe Hane</small>
          </span>
          <Icon name="chevron" size={14} />
        </button>
      </div>
    </aside>
  )
}

function MessageHeader({
  agent,
  time,
  leader = false,
}: {
  agent: AgentName
  time: string
  leader?: boolean
}) {
  return (
    <div className="message-header">
      <Avatar agent={agent} size="md" />
      <div>
        <strong>{agents[agent].name}</strong>
        <span>{agents[agent].role}</span>
      </div>
      {leader && (
        <span className="leader-pill">
          <Icon name="crown" size={10} /> Líder
        </span>
      )}
      <time>{time}</time>
    </div>
  )
}

function MainChat({
  active,
  onSettings,
  onArtifact,
}: {
  active: string
  onSettings: () => void
  onArtifact: (name: string) => void
}) {
  const activeConversation = conversations.find((item) => item.id === active)
  const individual = agents[(active as AgentName)]
  const title =
    activeConversation?.title ?? individual?.name ?? "Equipe de Desenvolvimento"
  const subtitle = activeConversation
    ? "4 agentes colaborando"
    : individual?.role

  return (
    <main className="chat">
      <header className="chat-header">
        <div className="chat-title-block">
          {activeConversation ? (
            <AgentStack names={activeConversation.agents} />
          ) : (
            <Avatar agent={active as AgentName || "orion"} size="md" />
          )}
          <div>
            <strong>{title}</strong>
            <span>
              <i className="online" /> {subtitle}
            </span>
          </div>
        </div>
        <div className="header-actions">
          <button className="quiet-action" onClick={onSettings}>
            <Icon name="users" />
            <span>Grupo</span>
          </button>
          <button className="icon-button">
            <Icon name="search" />
          </button>
          <button className="icon-button">
            <Icon name="more" />
          </button>
        </div>
      </header>

      <section className="messages">
        <div className="date-divider">
          <span>Hoje</span>
        </div>
        <article className="message">
          <MessageHeader agent="orion" time="09:42" leader />
          <div className="message-body">
            <p>
              Bom dia, equipe. Recebemos o repositório do novo serviço de
              autenticação. Vou organizar a análise para termos uma visão
              completa antes de propor alterações.
            </p>
            <div className="delegation-card">
              <div className="delegation-top">
                <span>
                  <Icon name="sparkles" size={14} /> Plano de execução
                </span>
                <small>3 tarefas</small>
              </div>
              <div className="delegate-row">
                <Avatar agent="byte" size="sm" />
                <span>
                  <strong>Mapear a arquitetura e dependências</strong>
                  <small>Delegado para Byte</small>
                </span>
                <span className="status running">
                  <i />
                  Executando
                </span>
              </div>
              <div className="delegate-row">
                <Avatar agent="nova" size="sm" />
                <span>
                  <strong>Analisar documentação e contexto</strong>
                  <small>Delegado para Nova</small>
                </span>
                <span className="status done">
                  <Icon name="check" size={11} />
                  Concluído
                </span>
              </div>
              <div className="delegate-row">
                <Avatar agent="cipher" size="sm" />
                <span>
                  <strong>Revisar riscos de segurança</strong>
                  <small>Delegado para Cipher</small>
                </span>
                <span className="status queued">Na fila</span>
              </div>
            </div>
          </div>
        </article>

        <article className="message compact-message">
          <MessageHeader agent="nova" time="09:44" />
          <div className="message-body">
            <p>
              <span className="mention">@Orion</span> revisei o README e os
              ADRs. O projeto usa uma arquitetura modular, com autenticação via
              JWT e rotação de refresh tokens.
            </p>
            <button
              className="file-card"
              onClick={() => onArtifact("resumo-contexto.md")}
            >
              <span className="file-icon">
                <Icon name="file" />
              </span>
              <span>
                <strong>resumo-contexto.md</strong>
                <small>Documento gerado · 4,2 KB</small>
              </span>
              <Icon name="external" size={14} />
            </button>
          </div>
        </article>

        <article className="message compact-message">
          <MessageHeader agent="byte" time="09:47" />
          <div className="message-body">
            <p>
              Mapeamento concluído. Encontrei <strong>24 módulos</strong> e uma
              dependência circular entre os serviços de sessão e usuário.
            </p>
            <div className="code-card">
              <div className="code-top">
                <span>
                  <Icon name="code" size={14} /> architecture-scan
                </span>
                <span className="success-label">
                  <Icon name="check" size={11} /> concluído em 18s
                </span>
              </div>
              <pre>
                <span>modules</span> 24{`\n`}
                <span>dependencies</span> 87{`\n`}
                <span>warnings</span> 1 circular dependency
              </pre>
              <button onClick={() => onArtifact("architecture-report.json")}>
                Ver resultado completo <Icon name="chevron" size={12} />
              </button>
            </div>
          </div>
        </article>

        <article className="message compact-message">
          <MessageHeader agent="orion" time="09:48" leader />
          <div className="message-body">
            <p>
              Ótimo trabalho. <span className="mention">@Cipher</span>, use os
              resultados do Byte para priorizar a revisão. Depois consolido tudo
              em um plano de implementação.
            </p>
            <div className="handoff">
              <div className="handoff-avatars">
                <Avatar agent="byte" size="sm" />
                <span>
                  <Icon name="chevron" size={12} />
                </span>
                <Avatar agent="cipher" size="sm" />
              </div>
              <div>
                <strong>Contexto compartilhado</strong>
                <small>3 arquivos e 1 resultado de execução</small>
              </div>
              <span className="status done">
                <Icon name="check" size={11} />
                Entregue
              </span>
            </div>
          </div>
        </article>
      </section>

      <div className="composer-wrap">
        <div className="composer">
          <textarea
            aria-label="Mensagem"
            placeholder="Envie uma mensagem para a equipe..."
          />
          <div className="composer-bottom">
            <div>
              <button aria-label="Anexar arquivo">
                <Icon name="paperclip" />
              </button>
              <button aria-label="Mencionar agente">
                <Icon name="at" />
              </button>
              <button aria-label="Comandos">
                <Icon name="command" />
              </button>
            </div>
            <span>⌘ Enter</span>
            <button className="send-button" aria-label="Enviar">
              <Icon name="send" size={15} />
            </button>
          </div>
        </div>
        <small>Os agentes podem cometer erros. Revise ações importantes.</small>
      </div>
    </main>
  )
}

function RightPanel({
  mode,
  onMode,
  onArtifact,
}: {
  mode: "context" | "group"
  onMode: (mode: "context" | "group") => void
  onArtifact: (name: string) => void
}) {
  const [leader, setLeader] = useState(true)
  if (mode === "group") {
    return (
      <aside className="right-panel">
        <div className="panel-header">
          <div>
            <strong>Configurações do grupo</strong>
            <span>4 de 10 agentes</span>
          </div>
          <button className="icon-button" onClick={() => onMode("context")}>
            <Icon name="chevron" />
          </button>
        </div>
        <div className="panel-scroll group-settings">
          <section className="panel-section">
            <div className="panel-section-title">
              <strong>Membros</strong>
              <button>
                <Icon name="plus" size={13} /> Adicionar
              </button>
            </div>
            {(["orion", "byte", "nova", "cipher"] as AgentName[]).map(
              (agent) => (
                <div className="member-row" key={agent}>
                  <Avatar agent={agent} size="sm" />
                  <span>
                    <strong>{agents[agent].name}</strong>
                    <small>{agents[agent].role}</small>
                  </span>
                  {agent === "orion" && leader && (
                    <Icon name="crown" size={14} />
                  )}
                  <button>
                    <Icon name="more" size={14} />
                  </button>
                </div>
              ),
            )}
          </section>
          <section className="panel-section leader-setting">
            <div>
              <span className="setting-icon">
                <Icon name="crown" />
              </span>
              <span>
                <strong>Líder do grupo</strong>
                <small>Coordena e delega tarefas</small>
              </span>
              <button
                className={`toggle ${leader ? "on" : ""}`}
                onClick={() => setLeader(!leader)}
              >
                <i />
              </button>
            </div>
            <p>
              {leader
                ? "Orion organiza o trabalho e mantém o contexto compartilhado."
                : "Sem líder, os agentes coordenam tarefas dinamicamente."}
            </p>
          </section>
          <section className="panel-section">
            <div className="panel-section-title">
              <strong>Permissões</strong>
            </div>
            <div className="permission">
              <span>Executar código</span>
              <span className="status done">
                <Icon name="check" size={11} />
                Permitido
              </span>
            </div>
            <div className="permission">
              <span>Criar e editar arquivos</span>
              <span className="status done">
                <Icon name="check" size={11} />
                Permitido
              </span>
            </div>
            <div className="permission">
              <span>Aprovação para publicar</span>
              <span className="status queued">Obrigatória</span>
            </div>
          </section>
        </div>
      </aside>
    )
  }

  return (
    <aside className="right-panel">
      <div className="panel-header">
        <div>
          <strong>Contexto da tarefa</strong>
          <span>Atualizado agora</span>
        </div>
        <button className="icon-button" onClick={() => onMode("group")}>
          <Icon name="more" />
        </button>
      </div>
      <div className="panel-scroll">
        <section className="panel-section preview-section">
          <div className="panel-section-title">
            <strong>Computador ao vivo</strong>
            <span className="live">
              <i /> AO VIVO
            </span>
          </div>
          <button
            className="computer-preview"
            onClick={() => onArtifact("Preview do computador")}
          >
            <div className="window-bar">
              <span />
              <span />
              <span />
              <small>auth-service</small>
            </div>
            <div className="window-body">
              <div className="mini-nav">
                <i />
                <i />
                <i />
                <i />
              </div>
              <div className="mini-editor">
                <span>auth / services</span>
                <b>session.service.ts</b>
                <code>
                  <em>12</em> export class SessionService {"{"}
                  <br />
                  <em>13</em>&nbsp;&nbsp;async rotateToken() {"{"}
                  <br />
                  <em>14</em>&nbsp;&nbsp;&nbsp;&nbsp;const session = await
                  <br />
                  <em>15</em>&nbsp;&nbsp;&nbsp;&nbsp;this.repository.find();
                </code>
              </div>
            </div>
            <div className="preview-caption">
              <span>
                <Icon name="monitor" size={13} /> Byte está analisando
              </span>
              <Icon name="external" size={13} />
            </div>
          </button>
        </section>

        <section className="panel-section">
          <div className="panel-section-title">
            <strong>Agentes ativos</strong>
            <span>3 trabalhando</span>
          </div>
          <div className="active-agent">
            <Avatar agent="byte" size="sm" />
            <span>
              <strong>Byte</strong>
              <small>Mapeando dependências</small>
            </span>
            <i className="pulse-dot" />
          </div>
          <div className="active-agent">
            <Avatar agent="cipher" size="sm" />
            <span>
              <strong>Cipher</strong>
              <small>Revisando segurança</small>
            </span>
            <i className="pulse-dot" />
          </div>
          <div className="active-agent">
            <Avatar agent="orion" size="sm" />
            <span>
              <strong>
                Orion <Icon name="crown" size={10} />
              </strong>
              <small>Coordenando equipe</small>
            </span>
            <span className="ready-dot" />
          </div>
        </section>

        <section className="panel-section task-progress">
          <div className="panel-section-title">
            <strong>Progresso</strong>
            <span>67%</span>
          </div>
          <div className="progress-track">
            <i />
          </div>
          <div className="progress-meta">
            <span>2 de 3 tarefas concluídas</span>
            <span>~3 min restantes</span>
          </div>
          <button className="details-button" onClick={() => onMode("group")}>
            Ver detalhes da tarefa <Icon name="chevron" size={13} />
          </button>
        </section>

        <section className="panel-section artifacts">
          <div className="panel-section-title">
            <strong>Artefatos gerados</strong>
            <span>3 arquivos</span>
          </div>
          <button onClick={() => onArtifact("resumo-contexto.md")}>
            <span className="artifact-icon doc">
              <Icon name="file" size={15} />
            </span>
            <span>
              <strong>resumo-contexto.md</strong>
              <small>Nova · 4,2 KB</small>
            </span>
            <Icon name="external" size={13} />
          </button>
          <button onClick={() => onArtifact("architecture-report.json")}>
            <span className="artifact-icon json">{"{}"}</span>
            <span>
              <strong>architecture-report.json</strong>
              <small>Byte · 12 KB</small>
            </span>
            <Icon name="external" size={13} />
          </button>
          <button onClick={() => onArtifact("security-review.md")}>
            <span className="artifact-icon lock">
              <Icon name="check" size={15} />
            </span>
            <span>
              <strong>security-review.md</strong>
              <small>Cipher · gerando...</small>
            </span>
            <span className="tiny-spinner" />
          </button>
        </section>

        <section className="approval-card">
          <div>
            <span className="approval-icon">
              <Icon name="sparkles" />
            </span>
            <span>
              <strong>Pronto para revisar</strong>
              <small>
                Revise os achados antes de autorizar o próximo passo.
              </small>
            </span>
          </div>
          <button onClick={() => onArtifact("Aprovação registrada")}>
            Revisar e gerar plano
          </button>
        </section>
      </div>
    </aside>
  )
}

export default function App() {
  const [active, setActive] = useState("dev")
  const [panelMode, setPanelMode] = useState<"context" | "group">("context")
  const [toast, setToast] = useState("")
  const toastKey = useMemo(() => toast, [toast])

  const showToast = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(""), 2200)
  }

  return (
    <div className="app-shell">
      <Sidebar
        active={active}
        onSelect={(id) => {
          setActive(id)
          showToast("Conversa aberta")
        }}
      />
      <MainChat
        active={active}
        onSettings={() => setPanelMode("group")}
        onArtifact={(name) => showToast(`${name} aberto`)}
      />
      <RightPanel
        mode={panelMode}
        onMode={setPanelMode}
        onArtifact={showToast}
      />
      {toast && (
        <div key={toastKey} className="toast">
          <Icon name="check" size={14} />
          {toast}
        </div>
      )}
    </div>
  )
}
