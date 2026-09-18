import { useEffect, useState, type FormEvent } from "react";
import { apiRequest } from "../services/api";
import { money } from "../services/money";
import { navigate } from "../routing";
type Method = "CREDIT_CARD" | "PIX" | "BOLETO";
export type PaymentView = {
  id: string; participantName: string; amountInCents: number; platformFeeInCents: number;
  method: Method | null; status: string; installments: number; cardLastFour: string | null;
  externalReference: string; expiresAt: string; createdAt: string; paidAt: string | null; refundedAt: string | null;
  waitlisted: boolean; waitlistPosition: number | null;
  event: { publicId: string; name: string; date: string; location: string };
  registration: { confirmationCode: string; cancellationToken: string; status: string } | null;
};
const statuses: Record<string, string> = { PENDING: "Pendente", PROCESSING: "Processando", APPROVED: "Aprovado", DECLINED: "Recusado", CANCELLED: "Cancelado", EXPIRED: "Expirado" };
export const methods: Record<Method, string> = { CREDIT_CARD: "Cartão de crédito", PIX: "PIX", BOLETO: "Boleto" };
export function savePayment(payment: PaymentView, accessToken: string) {
  sessionStorage.setItem(`payment:${payment.id}`, accessToken);
  sessionStorage.setItem(`event-payment:${payment.event.publicId}`, payment.id);
  navigate(`/payment/${payment.id}#${accessToken}`);
}
export function CheckoutPage({ id }: { id: string }) {
  const [token] = useState(() => { const hash = window.location.hash.slice(1); if (/^[a-f0-9]{64}$/.test(hash)) { sessionStorage.setItem(`payment:${id}`, hash); window.history.replaceState({}, "", window.location.pathname); return hash; } return sessionStorage.getItem(`payment:${id}`) ?? ""; });
  const [payment, setPayment] = useState<PaymentView | null>(null);
  const [method, setMethod] = useState<Method>("CREDIT_CARD");
  const [card, setCard] = useState("4111 1111 1111 1111");
  const [holder, setHolder] = useState("PESSOA TESTE");
  const [expiry, setExpiry] = useState("12/30");
  const [cvv, setCvv] = useState("123");
  const [cpf, setCpf] = useState("000.000.000-00");
  const [installments, setInstallments] = useState(1);
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false); const [now, setNow] = useState(Date.now());
  const headers = { "X-Payment-Token": token };
  async function refresh() { const data = await apiRequest<{ payment: PaymentView }>(`/api/public/payments/${id}`, { headers }); setPayment(data.payment); if(data.payment.method) { setMethod(data.payment.method); setInstallments(data.payment.installments); } }
  useEffect(() => { let live = true; const update = () => apiRequest<{ payment: PaymentView }>(`/api/public/payments/${id}`, { headers: { "X-Payment-Token": token } }).then(({ payment: p }) => { if (live) { setPayment(p); if(p.method) { setMethod(p.method); setInstallments(p.installments); } } }).catch(e => live && setError(e.message)); void update(); const poll = window.setInterval(update, 15000); const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => { live = false; clearInterval(poll); clearInterval(timer); }; }, [id, token]);
  async function process(action: "process" | "simulate-confirmation", cancel = false) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await apiRequest<{ payment: PaymentView }>(`/api/public/payments/${id}/${action}`, { method: "POST", headers, body: JSON.stringify({ method, installments: method === "CREDIT_CARD" ? installments : 1, cardLastFour: payment?.cardLastFour ?? card.replace(/\D/g, "").slice(-4), outcome: cancel ? "CANCELLED" : "PENDING" }) });
      setPayment(result.payment);
    } catch(e) { setError(e instanceof Error ? e.message : "Falha no pagamento"); } finally { setBusy(false); }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    if (method === "CREDIT_CARD" && !payment?.method && (!/^411111111111(?:1111|0002|9999)$/.test(card.replace(/\D/g, "")) || holder !== "PESSOA TESTE" || expiry !== "12/30" || cvv !== "123" || cpf !== "000.000.000-00")) { setError("Use os dados fictícios exibidos no formulário de cartão."); return; }
    void process(payment?.method ? "simulate-confirmation" : "process");
  }
  async function copy(value: string) { try { await navigator.clipboard.writeText(value); setNotice("Copiado."); } catch { setError("Não foi possível copiar. Selecione e copie o texto exibido."); } }
  const seconds = payment ? Math.max(0, Math.ceil((new Date(payment.expiresAt).getTime() - now) / 1000)) : 0;
  const pending = payment?.status === "PENDING" && seconds > 0;
  const paymentCode = payment ? `PAGAMENTO-${method}-${payment.externalReference.replace(/^DEMO-/, "")}` : "";
  const methodDescriptions: Record<Method, string> = {
    CREDIT_CARD: "Parcele em até 12x sem juros",
    PIX: "Código e confirmação de pagamento",
    BOLETO: "Gere o código e acompanhe a confirmação",
  };
  const paymentFields = payment ? <div className="checkout-method-fields">
    {!payment.method && method === "CREDIT_CARD" && <><p className="checkout-test-hint">Para esta versão, use os dados fictícios já preenchidos abaixo.</p><label>Nome impresso no cartão<input autoComplete="off" value={holder} onChange={e => setHolder(e.target.value)} required /></label><label>Número do cartão<input inputMode="numeric" autoComplete="off" value={card} maxLength={19} onChange={e => setCard(e.target.value.replace(/\D/g, "").slice(0,16).replace(/(.{4})/g, "$1 ").trim())} required /></label><div className="form-grid"><label>Validade<input placeholder="12/30" value={expiry} maxLength={5} onChange={e => setExpiry(e.target.value.replace(/\D/g, "").slice(0,4).replace(/^(\d{2})(\d)/, "$1/$2"))} required /></label><label>CVV<input autoComplete="off" value={cvv} maxLength={3} onChange={e => setCvv(e.target.value.replace(/\D/g, ""))} required /></label></div><label>CPF do titular<input autoComplete="off" value={cpf} maxLength={14} onChange={e => setCpf(e.target.value.replace(/\D/g, "").slice(0,11).replace(/^(\d{3})(\d)/,"$1.$2").replace(/^(\d{3})\.(\d{3})(\d)/,"$1.$2.$3").replace(/(\d{3})(\d{1,2})$/,"$1-$2"))} required /></label><label>Quantidade de parcelas<select value={installments} onChange={e => setInstallments(Number(e.target.value))}>{Array.from({ length:12 }, (_,i) => <option key={i} value={i+1}>{i+1}x sem juros</option>)}</select></label><p>{installments} parcelas de aproximadamente {money(Math.floor(payment.amountInCents/installments))}; ajuste de centavos na primeira parcela ({money(Math.floor(payment.amountInCents/installments)+payment.amountInCents%installments)}).</p></>}
    {method !== "CREDIT_CARD" && <><p>Confira os dados abaixo antes de continuar.</p>{method === "PIX" ? <div className="fake-qr" role="img" aria-label="Código QR do pagamento"><span>PIX</span></div> : <div className="fake-barcode" role="img" aria-label="Código de barras do pagamento" />}<label>{method === "PIX" ? "PIX copia e cola" : "Linha digitável"}<textarea readOnly value={paymentCode} /></label><button type="button" className="button button-secondary" onClick={() => copy(paymentCode)}>Copiar código</button><p>Vencimento: {new Date(payment.expiresAt).toLocaleString("pt-BR")}</p></>}

    {payment.method && <p className="checkout-test-hint">Pagamento iniciado. Use o botão de confirmação para concluir.</p>}
  </div> : null;

  return <main className="payment-page">
    <nav className="checkout-navigation" aria-label="Navegação do pagamento"><button className="checkout-link" onClick={() => navigate(payment ? `/event/${payment.event.publicId}` : "/")}>← Voltar ao evento</button><span>Evento360</span></nav>
    {error && <p className="alert alert-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!payment ? <p role="status">Carregando pagamento…</p> : <div className="checkout-grid">
      <div className="checkout-main">
        <section className="checkout-panel checkout-event">
          <div className="checkout-section-heading"><h1>{payment.registration ? "Comprovante de inscrição" : "Sua inscrição"}</h1><span className={`checkout-status checkout-status-${payment.status.toLowerCase()}`} role="status">{busy ? "Processando…" : statuses[payment.status]}</span></div>
          <h2>{payment.event.name}</h2><p>{new Date(payment.event.date).toLocaleString("pt-BR")}</p>
          {payment.waitlistPosition && pending ? <p className="checkout-test-hint">Você está na posição {payment.waitlistPosition} da lista de espera. Atualize o status e confirme o pagamento quando houver uma vaga disponível.</p> : null}
          {payment.registration && <div className="checkout-proof"><span>Código de confirmação</span><strong>{payment.registration.confirmationCode}</strong><p>Inscrição {payment.registration.status === "ACTIVE" ? "confirmada" : "cancelada"}.</p>{payment.refundedAt && <p>Reembolso registrado.</p>}</div>}
        </section>

        {pending && <section className="checkout-panel checkout-payment-options">
          <h2>Meios de pagamento</h2>
          <form id="checkout-payment-form" onSubmit={submit}>
            <fieldset disabled={busy}>
              <legend className="checkout-sr-only">Escolha como pagar sua inscrição</legend>
              {(Object.keys(methods) as Method[]).map(m => <div key={m} className={`checkout-method ${method === m ? "is-selected" : ""}`}>
                <label className="checkout-method-choice">
                  <input type="radio" name="method" value={m} checked={method === m} disabled={Boolean(payment.method)} onChange={() => setMethod(m)} aria-controls={`payment-fields-${m}`} />
                  <span className={`checkout-method-icon checkout-method-icon-${m.toLowerCase()}`} aria-hidden="true">{m === "CREDIT_CARD" ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h4"/></svg> : m === "PIX" ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m12 2 10 10-10 10L2 12 12 2Z"/><path d="m6 8 4 4-4 4m12-8-4 4 4 4"/></svg> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 4v16M7 4v16M11 4v16M13 4v16M17 4v16M20 4v16"/></svg>}</span>
                  <span className="checkout-method-copy"><strong>{methods[m]}</strong><small>{methodDescriptions[m]}</small></span>
                </label>
                {method === m && <div id={`payment-fields-${m}`}>{paymentFields}</div>}
              </div>)}
            </fieldset>
          </form>
        </section>}

        <section className="checkout-panel checkout-billing"><h2>Dados do participante</h2><p>{payment.participantName}</p><span className="checkout-muted">Titular da inscrição</span></section>

        <section className="checkout-panel checkout-followup"><h2>Acompanhe sua inscrição</h2>
          {!pending && !payment.registration && <p>Nenhuma inscrição foi confirmada. Retorne ao evento para iniciar uma nova tentativa.</p>}
          <div className="checkout-action-links"><button className="checkout-link" disabled={busy} onClick={() => refresh().catch(e => setError(e.message))}>Atualizar status</button><button className="checkout-link" onClick={() => copy(`${window.location.origin}/payment/${id}#${token}`)}>Copiar link de acompanhamento</button><button className="checkout-link" onClick={() => navigate("/my-events")}>Minhas inscrições</button></div>
          <small className="checkout-muted">Guarde seu link privado para consultar o pagamento.</small>
          {pending && <button className="checkout-link checkout-cancel" disabled={busy} onClick={() => process("process", true)}>Cancelar pagamento</button>}
          {payment.registration && <button className="checkout-link checkout-cancel" onClick={() => navigate(`/registration/cancel/${payment.registration!.cancellationToken}`)}>Consultar ou cancelar inscrição</button>}
        </section>
      </div>

      <aside className="checkout-panel purchase-summary" aria-label="Resumo da compra">
        <h2>Resumo da compra</h2>
        <dl className="checkout-totals"><div><dt>Inscrição</dt><dd>{money(payment.amountInCents)}</dd></div><div><dt>Taxa de serviço <small>Já incluída no valor (5%)</small></dt><dd>{money(payment.platformFeeInCents)}</dd></div><div className="checkout-total"><dt>Total</dt><dd>{money(payment.amountInCents)}</dd></div></dl>
        <p className="checkout-summary-method">{methods[payment.method ?? method]}</p>
        {(payment.method ?? method) === "CREDIT_CARD" && <p className="checkout-installment-summary">{payment.installments && payment.method ? payment.installments : installments}x sem juros</p>}
        {payment.cardLastFour && <p className="checkout-muted">Cartão final {payment.cardLastFour}</p>}
        {pending && <button className="checkout-pay-button" type="submit" form="checkout-payment-form" disabled={busy}>{busy ? "Processando…" : payment.method ? "Confirmar pagamento" : "Pagar e finalizar"}</button>}
        {payment.registration && <button className="checkout-pay-button" onClick={() => window.print()}>Imprimir comprovante</button>}
        {!pending && !payment.registration && <button className="checkout-pay-button" onClick={() => navigate(`/event/${payment.event.publicId}`)}>Voltar ao evento</button>}
        <p className="checkout-summary-note">{payment.paidAt ? `Aprovado em ${new Date(payment.paidAt).toLocaleString("pt-BR")}` : "A confirmação está sujeita à disponibilidade de vagas."}</p>
        {payment.method && <small className="checkout-reference">Referência: {payment.externalReference.replace(/^DEMO-/, "PAGAMENTO-")}</small>}
      </aside>
    </div>}
  </main>;
}

export function FinancialPanel() {
 const [data, setData] = useState<{ summary: { grossInCents: number; feeInCents: number; netInCents: number; counts: Record<string,number> }; payments: Array<Pick<PaymentView,"id"|"participantName"|"method"|"status"|"amountInCents"|"createdAt"|"externalReference"|"refundedAt"> & { event: {name:string} }> } | null>(null);
 const [error,setError] = useState("");
 useEffect(() => { apiRequest<NonNullable<typeof data>>("/api/admin/financial-summary", {auth:"organizer"}).then(setData).catch(e=>setError(e.message)); },[]);
 return <><h1>Financeiro</h1>{error && <p role="alert">{error}</p>}{!data ? <p>Carregando receitas…</p> : <><div className="metrics-grid">{[["Receita bruta",data.summary.grossInCents],["Comissão Evento360",data.summary.feeInCents],["Receita líquida",data.summary.netInCents]].map(([title,value])=><article className="metric-card" key={title}><span>{title}</span><strong>{money(Number(value))}</strong></article>)}</div><p>Aprovados: {data.summary.counts.APPROVED??0} · Pendentes: {data.summary.counts.PENDING??0} · Recusados: {data.summary.counts.DECLINED??0}</p><p>Receitas consideram somente aprovações não canceladas. Últimas 200 transações; totais consideram todo o histórico.</p><div className="financial-table"><table><thead><tr>{["Evento","Participante","Método","Valor","Status","Data","Referência"].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{data.payments.map(p=><tr key={p.id}><td>{p.event.name}</td><td>{p.participantName}</td><td>{p.method ? methods[p.method] : "Não escolhido"}</td><td>{money(p.amountInCents)}</td><td>{statuses[p.status]}{p.refundedAt ? " · reembolso registrado" : ""}</td><td>{new Date(p.createdAt).toLocaleString("pt-BR")}</td><td>{p.externalReference.replace(/^DEMO-/, "PAGAMENTO-")}</td></tr>)}</tbody></table>{data.payments.length===0 && <p>Nenhuma transação.</p>}</div></>}</>;
}
