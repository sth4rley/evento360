import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const stagedFiles = new Set(execFileSync("git", ["ls-files", "--cached", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean));
const files = [...new Set(execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean))];
const privateValues = [];
for (const file of [".env", "backend/.env", "frontend/.env", "frontend/.env.local"]) {
  let source;
  try { source = readFileSync(resolve(root, file), "utf8"); } catch { continue; }
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (!match || !/SECRET|PASSWORD|API_KEY|DATABASE_URL/.test(match[1])) continue;
    let value = match[2].replace(/^['"]|['"]$/g, "");
    if (match[1].includes("DATABASE_URL")) {
      try { value = decodeURIComponent(new URL(value).password); } catch { continue; }
    }
    if (value.length >= 12 && !/replace-with|change-me/.test(value)) privateValues.push(value);
  }
}
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{50,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\bre_[A-Za-z0-9]{24,}\b/,
];
const findings = [];
for (const file of files) {
  if (/(^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith(".env.example")) {
    findings.push(`${file}: arquivo de ambiente incluído no Git`);
    continue;
  }
  const versions = [];
  try { versions.push(readFileSync(resolve(root, file))); } catch (error) {
    if (error.code !== "ENOENT") throw new Error(`Não foi possível verificar ${file}`);
  }
  if (stagedFiles.has(file)) {
    try { versions.push(execFileSync("git", ["show", `:${file}`], { cwd: root, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 })); }
    catch { throw new Error(`Não foi possível verificar o conteúdo staged de ${file}`); }
  }
  if (versions.some((version) => patterns.some((pattern) => pattern.test(version.toString("utf8"))) || privateValues.some((value) => version.includes(Buffer.from(value))))) {
    findings.push(`${file}: possível credencial; revisar localmente (valor oculto)`);
  }
}
if (findings.length) {
  console.error(findings.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`${files.length} arquivos verificados: nenhum segredo detectado pelos padrões e valores locais conhecidos.`);
}
