import "dotenv/config";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildTicketEmailHtml,
  sendTicketEmail,
} from "../src/services/resend.js";
import { buildTicketQrCodeUrl } from "../src/services/registration-notifications.js";

async function main() {
  const targetEmail =
    process.argv[2] ||
    process.env.TEST_EMAIL ||
    "participante.teste@exemplo.com";
  const participantName = "Carlos Augusto";
  const eventName = "Evento360 Summit 2026";
  const ticketCode = "EV360-849204-BR";
  const qrCodeUrl = buildTicketQrCodeUrl(ticketCode);

  console.log(
    "=== Simulação de Fluxo de Inscrição e Homologação de Ticket (QA) ===",
  );
  console.log(`Participante: ${participantName}`);
  console.log(`Evento: ${eventName}`);
  console.log(`E-mail de Destino: ${targetEmail}`);
  console.log(`Código do Ingresso: ${ticketCode}`);
  console.log(`URL do QR Code: ${qrCodeUrl}`);
  console.log("");

  // 1. Gerar e salvar preview do HTML para validação visual e de responsividade
  const html = buildTicketEmailHtml(
    participantName,
    eventName,
    ticketCode,
    qrCodeUrl,
  );
  const previewPath = resolve(process.cwd(), "ticket-preview.html");
  writeFileSync(previewPath, html, "utf-8");
  console.log(`[QA] Arquivo de visualização HTML salvo em: ${previewPath}`);
  console.log(
    "[QA] Abra esse arquivo no navegador para conferir o layout e testar a leitura do QR Code com a câmera do celular!",
  );
  console.log("");

  // 2. Testar envio via Resend se houver API key configurada
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey === "sua_chave_aqui" || apiKey === "re_placeholder") {
    console.log(
      "[Resend] Chave de API ainda está com valor de exemplo ('sua_chave_aqui').",
    );
    console.log(
      "[Resend] Para enviar um e-mail real para sua caixa de entrada, execute:",
    );
    console.log(
      `         npx tsx scripts/simulate-ticket-flow.ts seu_email@dominio.com`,
    );
    console.log(
      "         (com a RESEND_API_KEY real configurada no arquivo .env)",
    );
    return;
  }

  console.log(`[Resend] Disparando e-mail de teste para ${targetEmail}...`);
  const result = await sendTicketEmail(
    targetEmail,
    participantName,
    eventName,
    ticketCode,
    qrCodeUrl,
  );

  if (result.success) {
    console.log("[Resend] E-mail enviado com sucesso!");
    console.log("[Resend] Resposta da API / ID do Envio:", result.data);
  } else {
    console.error("[Resend] Falha no disparo:", result.error);
  }
}

main().catch((error) => {
  console.error("Erro na simulação:", error);
  process.exit(1);
});
