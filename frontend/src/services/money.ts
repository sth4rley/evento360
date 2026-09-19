export function money(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function parseReais(value: string): number | null {
  const clean = value.replace(/[^\d,]/g, "");
  if (!clean) return null;
  const parts = clean.split(",");
  const reais = parseInt(parts[0] || "0", 10);
  const centsStr = parts[1] ? parts[1].padEnd(2, "0").substring(0, 2) : "0";
  const cents = parseInt(centsStr, 10);
  return reais * 100 + cents;
}

export function priceLabel(event: { isPaid?: boolean; priceInCents?: number | null } | null | undefined): string {
  if (!event || !event.isPaid || event.priceInCents == null || event.priceInCents === 0) return "Gratuito";
  return money(event.priceInCents);
}
