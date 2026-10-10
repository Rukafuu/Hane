import { ArrowRight, LockSimple, Sparkle, UsersThree } from '@phosphor-icons/react';
import { HaneGarden, useGardenInteraction } from './HaneGarden.jsx';
export default function WelcomeScreen({onStart}) {
  const garden=useGardenInteraction();
  return <main className="profile-stage hane-welcome-screen">
    <section className="profile-welcome-art" aria-label="Hane Garden">
      <img src="/brand/hane-logo.png" alt="Hane"/>
      <HaneGarden controller={garden}/>
      <p>Um espaço seu.<br/>Muitas possibilidades.</p>
      <small>Local por escolha. Pessoal por natureza.</small>
    </section>
    <section className="profile-welcome-content"><div className="welcome-introduction">
      <span className="profile-eyebrow">BEM-VINDO AO HANE</span>
      <h1>Suas ideias.<br/>Um novo lugar<br/>para ganhar vida.</h1>
      <p className="welcome-lead">Seu espaço de trabalho com inteligência artificial. Com calma, do seu jeito.</p>
      <div className="welcome-values"><p><LockSimple aria-hidden="true"/><span><strong>Seu, desde o começo.</strong><small>Um perfil local. Sem cadastro na internet.</small></span></p><p><Sparkle aria-hidden="true"/><span><strong>A inteligência à sua escolha.</strong><small>Configure um provedor quando fizer sentido.</small></span></p><p><UsersThree aria-hidden="true"/><span><strong>Espaço para colaborar.</strong><small>Organize seus agentes e decida quando começar.</small></span></p></div>
      <button type="button" className="profile-primary welcome-start" onPointerEnter={()=>garden.event('explore')} onFocus={()=>garden.event('explore')} onClick={onStart}>Começar meu Hane <ArrowRight aria-hidden="true"/></button>
      <small className="welcome-footnote">Só precisamos de um nome para começar. O resto pode esperar.</small>
    </div></section>
  </main>;
}
