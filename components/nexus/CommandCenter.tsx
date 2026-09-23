"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DEMO_SCENARIOS } from "@/lib/nexus/demo/scenarios";

const listed = DEMO_SCENARIOS.filter((scenario) => scenario.listed);

export function CommandCenter() {
  const router = useRouter();
  const [objective, setObjective] = useState("");
  const [source, setSource] = useState<string>("upload");
  const scenario = listed.find((item) => item.id === source);
  const start = () => {
    const stated = objective.trim() || scenario?.objective || "";
    const query = new URLSearchParams();
    if (stated) query.set("objective", stated);
    if (scenario) query.set("demo", scenario.id);
    router.push(`/investigate${query.size ? `?${query}` : ""}`);
  };
  const choose = (id: string) => {
    setSource(id);
    const next = listed.find((item) => item.id === id);
    if (next && !objective.trim()) setObjective(next.objective);
  };

  return <main className="command-center command-redesign">
    <a className="skip-link" href="#main-content">Перейти к содержимому</a>
    <header className="command-header">
      <div className="brand"><span className="brand-mark">N</span><div><strong>NEXUS</strong><small>АВТОНОМНАЯ СИСТЕМА РАССЛЕДОВАНИЯ РИСКОВ</small></div></div>
      <span className="command-title">КОМАНДНЫЙ ЦЕНТР</span>
      <div className="command-status"><i>●</i> СИСТЕМА ГОТОВА</div>
    </header>

    <section className="command-hero" id="main-content">
      <div className="command-question">
        <p className="eyebrow">АВТОНОМНАЯ СИСТЕМА РАССЛЕДОВАНИЯ РИСКОВ</p>
        <h1>ЧТО НАЧИНАЕТ<br />МЕНЯТЬСЯ В СИСТЕМЕ —<br /><em>И ЧЕМ ЭТО МОЖЕТ ОБЕРНУТЬСЯ?</em></h1>
        <p>NEXUS расследует, как зарождающийся риск распространяется через связанные показатели. Система сама выбирает детерминированные аналитические инструменты, собирает доказательства, оспаривает собственное объяснение и сообщает, что подтвердилось, а что — нет.</p>
      </div>

      <aside className="new-case-module start-module">
        <p>НОВОЕ РАССЛЕДОВАНИЕ</p>
        <label className="objective-field">
          <strong>ЧТО ВЫ ХОТИТЕ РАССЛЕДОВАТЬ?</strong>
          <textarea
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            rows={3}
            placeholder="Исследовать, почему растёт риск отставания от графика проекта."
            aria-label="Цель расследования"
          />
        </label>

        <div className="source-field">
          <strong>КАКИЕ ДАННЫЕ ИСПОЛЬЗОВАТЬ?</strong>
          <div className="source-options">
            <button type="button" className={`source-option ${source === "upload" ? "selected" : ""}`} aria-pressed={source === "upload"} onClick={() => setSource("upload")}>
              <b>ВАШИ ДАННЫЕ</b><span>Загрузить CSV или XLSX</span>
            </button>
            {listed.map((item) => <button type="button" key={item.id} className={`source-option ${source === item.id ? "selected" : ""}`} aria-pressed={source === item.id} onClick={() => choose(item.id)}>
              <b>{item.title.toUpperCase()}</b><span>{item.sector} · подготовленные данные</span>
            </button>)}
          </div>
        </div>

        <button type="button" className="start-investigation" onClick={start}>НАЧАТЬ РАССЛЕДОВАНИЕ →</button>
        <small>{scenario ? scenario.summary : "Файлы обрабатываются временно, только в рамках вашей браузерной сессии. Ничего не сохраняется."}</small>
      </aside>
    </section>

    <section className="agentic-strip">
      <div className="agentic-flow">
        <span><b>OBSERVER</b>Замечает изменение</span><i>→</i>
        <span><b>INVESTIGATOR</b>Проверяет объяснения</span><i>→</i>
        <span><b>SKEPTIC</b>Оспаривает их</span><i>↳</i>
        <span><b>ORCHESTRATOR</b>Координирует пересмотр</span>
      </div>
      <div className="agentic-facts"><span>АГЕНТЫ РЕШАЮТ, ЧТО ИССЛЕДОВАТЬ</span><span>ДЕТЕРМИНИРОВАННЫЕ ИНСТРУМЕНТЫ СЧИТАЮТ ЦИФРЫ</span><span>ПРОВЕРЯЕМЫЕ ДОКАЗАТЕЛЬСТВА</span><span>ПРИЧИННОСТЬ НИКОГДА НЕ ПРЕДПОЛАГАЕТСЯ</span></div>
    </section>

    <section className="how-nexus">
      <div><p className="section-kicker">КАК NEXUS РАССЛЕДУЕТ</p><h2>От меняющегося сигнала<br />к обоснованному выводу.</h2></div>
      <ol>
        <li><span>01</span><strong>НАБЛЮДЕНИЕ</strong><p>Что начинает меняться?</p></li>
        <li><span>02</span><strong>ИССЛЕДОВАНИЕ</strong><p>Какие объяснения согласуются с данными?</p></li>
        <li><span>03</span><strong>ПРОВЕРКА</strong><p>Чем ещё можно объяснить наблюдение?</p></li>
        <li><span>04</span><strong>ПЕРЕСМОТР</strong><p>Выдержала ли гипотеза критическую проверку?</p></li>
        <li><span>05</span><strong>ВЫВОД</strong><p>Что известно, что предполагается, а что всё ещё неизвестно?</p></li>
      </ol>
    </section>

    <footer className="nexus-footer">
      <span>NEXUS / АВТОНОМНАЯ СИСТЕМА РАССЛЕДОВАНИЯ РИСКОВ</span>
    </footer>
  </main>;
}
