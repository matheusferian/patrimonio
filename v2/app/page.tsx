import { safeToSpend, weeklyFundingStatus } from '../lib/finance';

const position = {
  liquidCash: 0,
  protectedReserve: 0,
  obligations14d: 0,
  conservativeIncome14d: 0,
};

const dental = weeklyFundingStatus({
  name: 'Dentista',
  weeklySetAside: 130,
  monthlyCharge: 520,
}, 0);

function Money({ value }: { value: number }) {
  return <>{value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</>;
}

export default function Home() {
  const safe = safeToSpend(position);

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">FERIAN FINANCE</div>
          <h1>Financial Command Center</h1>
          <p>Controle doméstico em tempo real para renda variável.</p>
        </div>
        <div className="status">V2 · DEVELOPMENT</div>
      </header>

      <section className="hero">
        <div>
          <span className="label">SAFE TO SPEND TODAY</span>
          <strong><Money value={safe} /></strong>
          <p>Será calculado com saldos reais, obrigações, reserva e renda conservadora.</p>
        </div>
        <button>Ask Finance</button>
      </section>

      <section className="grid four">
        <article className="card"><span className="label">Available now</span><b>Conectar dados</b><small>Checking + savings</small></article>
        <article className="card"><span className="label">Next 14 days</span><b>Conectar contas</b><small>Pagamentos e cartões</small></article>
        <article className="card"><span className="label">Income forecast</span><b>Variável</b><small>Conservador · provável</small></article>
        <article className="card"><span className="label">Household</span><b>2 membros</b><small>Matheus + Lidyane</small></article>
      </section>

      <section className="grid two">
        <article className="panel">
          <div className="panelHead"><h2>Accounts</h2><span>LIVE DATA NEXT</span></div>
          <div className="empty">Savings, checking e cartões aparecerão aqui por usuário e household.</div>
        </article>

        <article className="panel">
          <div className="panelHead"><h2>Installment plans</h2><span>TRACKER</span></div>
          <div className="planRow">
            <div><b>Dentista</b><small>Reserva semanal planejada</small></div>
            <strong>$130 / semana</strong>
          </div>
          <div className="progress"><i style={{ width: `${Math.min(100, (dental.funded / dental.monthlyTarget) * 100)}%` }} /></div>
          <small className="muted">A cobrança mensal real e o cartão serão vinculados depois que identificarmos a transação correta.</small>
        </article>
      </section>

      <section className="panel ask">
        <div><span className="label">ASK FERIAN AI</span><h2>“Posso gastar $300 hoje?”</h2><p>A resposta usará saldo, próximos débitos, renda variável, reservas, cartão e parcelas.</p></div>
        <button>Em breve</button>
      </section>
    </main>
  );
}
