import { useEffect, useRef, useState, useId } from 'react';
import { HaneAvatar } from './HaneAvatar.jsx';
import { createGardenController } from './garden-controller.js';
import { driveGarden, reduceMotion } from './motion.js';
import './garden.css';

export function useGardenInteraction() {
  const controller = useRef(null);
  if (!controller.current) controller.current = createGardenController();
  return controller.current;
}

export function HaneGarden({ controller }) {
  const root = useRef(null);
  const helpId = useId();
  const behaviour = useRef({ state: 'idle', gazeX: 0, gazeY: 0, blink: 0 });
  const [reduced, setReduced] = useState(reduceMotion);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const refresh = () => setReduced(reduceMotion());
    media.addEventListener('change', refresh);
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-hane-motion'] });
    return () => { media.removeEventListener('change', refresh); observer.disconnect(); };
  }, []);
  useEffect(() => driveGarden(root.current, controller, behaviour, reduced), [controller, reduced]);
  return <div className="hane-garden" ref={root} data-garden-state="idle" data-reduced={reduced}>
    <div className="garden-halo" aria-hidden="true"/>
    <svg className="garden-orbit" viewBox="0 0 320 270" aria-hidden="true"><ellipse cx="160" cy="133" rx="130" ry="62" transform="rotate(-19 160 133)"/></svg>
    <div className="garden-family" aria-hidden="true">{[
      ['#eab2c9','pebble'],['#c7bde4','cloud'],['#aacde5','circle'],['#b7d9c4','pebble'],['#ead298','cloud'],['#edbea6','circle'],['#d5d7b2','pebble'],
    ].map(([color,shape],index)=><span key={color} className="garden-family-member" data-family-index={index}><HaneAvatar name="Companheiro do Hane" shape={shape} color={color} size={70} reducedMotion decorative/></span>)}</div>
    <button type="button" className="garden-mascot" aria-label="Brincar com o Hane" aria-describedby={helpId} onClick={()=>controller.mascotClick()}><HaneAvatar name="Hane" shape="pebble" color="#fff7fb" size={250} intensity={0.65} reducedMotion={reduced} behaviourRef={behaviour} decorative garden/></button>
    <button type="button" className="garden-orb" aria-label="Explorar a esfera do Hane" title="Arraste a esfera ou explore com Enter" onClick={()=>controller.orbClick()}><span/></button>
    <svg className="garden-feather" viewBox="0 0 100 100" aria-hidden="true"><path d="M21 81C19 51 34 19 79 17C79 58 55 78 21 81Z"/><path d="M16 87L69 29M29 73L30 49M43 59L44 35M40 63L62 60"/></svg>
    <span className="garden-kanji" aria-hidden="true">羽</span>
    <div className="garden-petals" aria-hidden="true">{[0,1,2,3,4].map(i=><i key={i} style={{'--petal-index':i}}/>)}</div>
    <span className="garden-sleep" aria-hidden="true">· · ·</span>
    <p className="garden-family-caption" role="status" aria-live="polite"/>
    <span id={helpId} className="sr-only">Um clique no mascote faz ele pular. Arraste para movê-lo; cinco ativações próximas revelam sete companheiros. Enter e Espaço também funcionam.</span>
    <span className="sr-only">Ilustração interativa. A esfera pode ser arrastada; cinco ativações revelam uma pena. Ela não altera seu perfil.</span>
  </div>;
}
