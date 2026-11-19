// =====================================================================
// 🧪 MODO TESTE: substitui o Supabase por uma base de dados no próprio browser.
// - Os dados vêm de um ficheiro .json exportado do Obsidian ([[Exportar para Teste]]).
// - Ficam guardados só neste browser (localStorage). Nada vai para o GitHub nem para a internet.
// - Login: qualquer email e qualquer palavra-passe (o email aparece no Histórico).
// - Tempo real: abre o site em dois separadores e as mudanças passam de um para o outro.
// Tem a mesma API que o app.js usa do supabase-js, por isso o app.js é igual ao original.
// =====================================================================

const CHAVE_DADOS = "lidl-teste-dados";
const CHAVE_SESSAO = "lidl-teste-sessao";
const TABELAS = ["registos", "tarefas", "equipamentos", "modelos_checklist", "historico"];
const canalBrowser = "BroadcastChannel" in window ? new BroadcastChannel("lidl-teste") : null;

const agora = () => new Date().toISOString();
const uuid = () =>
  crypto.randomUUID
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });
const copia = (o) => JSON.parse(JSON.stringify(o));

// ---------- Base de dados ----------
function lerBD() {
  try {
    const bd = JSON.parse(localStorage.getItem(CHAVE_DADOS)) || {};
    TABELAS.forEach((t) => (bd[t] = bd[t] || []));
    return bd;
  } catch {
    return Object.fromEntries(TABELAS.map((t) => [t, []]));
  }
}
let bd = lerBD();

function gravarBD() {
  try {
    localStorage.setItem(CHAVE_DADOS, JSON.stringify(bd));
  } catch (e) {
    alert("Não consegui guardar no browser (espaço cheio?): " + e.message);
  }
}

// Valores por omissão de cada tabela (iguais ao schema.sql)
const OMISSAO = {
  registos: () => ({ status: "⏳ Por iniciar", arquivado: false, criado_em: agora(), atualizado_em: agora(), atualizado_por: quemSou() }),
  tarefas: () => ({ ordem: 0, status: "⏳ Por iniciar", notas: "" }),
  equipamentos: () => ({ ordem: 0, numero: "", instalado: false, confluence: false, prioritario: false, master_sco: false, nagios: false }),
  modelos_checklist: () => ({}),
  historico: () => ({ quando: agora() }),
};

// Histórico (como os triggers do schema.sql): registos em tudo, tarefas só nas alterações
function historico(tabela, acao, antes, depois) {
  if (tabela !== "registos" && !(tabela === "tarefas" && acao === "UPDATE")) return;
  const r = depois || antes;
  const ids = bd.historico.map((h) => h.id);
  bd.historico.push({
    id: ids.length ? Math.max(...ids) + 1 : 1,
    quando: agora(),
    quem: quemSou(),
    tabela,
    registo_id: tabela === "registos" ? r.id : r.registo_id,
    acao,
    antes: antes ? copia(antes) : null,
    depois: depois ? copia(depois) : null,
  });
}

function avisarOutros(tabela) {
  canalBrowser?.postMessage({ tabela });
}

// ---------- Pedidos (from(...).select/insert/update/delete) ----------
function comparar(a, b) {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  return a < b ? -1 : 1;
}

class Pedido {
  constructor(tabela) {
    this.tabela = tabela;
    this.op = "select";
    this.filtros = [];
    this.ordens = [];
  }
  // depois de insert/update/delete, .select() só pede as linhas de volta
  select() {
    if (this.op !== "select") this.devolver = true;
    return this;
  }
  insert(v) { this.op = "insert"; this.valores = v; return this; }
  update(v) { this.op = "update"; this.valores = v; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c, v) { this.filtros.push([c, v]); return this; }
  order(c, { ascending = true } = {}) { this.ordens.push([c, ascending]); return this; }
  range(de, ate) { this.intervalo = [de, ate]; return this; }
  limit(n) { this.limite = n; return this; }
  single() { this.umSo = true; return this; }
  get executores() {
    return { select: this._select, insert: this._insert, update: this._update, delete: this._delete };
  }
  then(ok, erro) {
    return Promise.resolve().then(() => this.executar()).then(ok, erro);
  }

  linhas() {
    if (!bd[this.tabela]) throw new Error(`Tabela desconhecida: ${this.tabela}`);
    return bd[this.tabela].filter((l) => this.filtros.every(([c, v]) => l[c] === v));
  }

  executar() {
    try {
      let data = this.executores[this.op].call(this);
      if (this.umSo) {
        if (!data || data.length !== 1) throw new Error("Esperava exatamente 1 linha.");
        data = data[0];
      }
      return { data, error: null };
    } catch (e) {
      return { data: null, error: { message: e.message } };
    }
  }

  _select() {
    let l = this.linhas().slice();
    if (this.ordens.length)
      l.sort((a, b) => {
        for (const [c, asc] of this.ordens) {
          const r = comparar(a[c], b[c]);
          if (r) return asc ? r : -r;
        }
        return 0;
      });
    if (this.intervalo) l = l.slice(this.intervalo[0], this.intervalo[1] + 1);
    if (this.limite !== undefined) l = l.slice(0, this.limite);
    return copia(l);
  }

  _insert() {
    const novas = (Array.isArray(this.valores) ? this.valores : [this.valores]).map((v) => ({
      id: uuid(),
      ...OMISSAO[this.tabela](),
      ...copia(v),
    }));
    bd[this.tabela].push(...novas);
    novas.forEach((n) => historico(this.tabela, "INSERT", null, n));
    gravarBD();
    avisarOutros(this.tabela);
    return this.devolver ? copia(novas) : null;
  }

  _update() {
    const alvo = this.linhas();
    alvo.forEach((l) => {
      const antes = copia(l);
      Object.assign(l, copia(this.valores));
      if (this.tabela === "registos") Object.assign(l, { atualizado_em: agora(), atualizado_por: quemSou() });
      historico(this.tabela, "UPDATE", antes, l);
    });
    gravarBD();
    avisarOutros(this.tabela);
    return this.devolver ? copia(alvo) : null;
  }

  _delete() {
    const alvo = this.linhas();
    const ids = new Set(alvo.map((l) => l.id));
    bd[this.tabela] = bd[this.tabela].filter((l) => !ids.has(l.id));
    if (this.tabela === "registos") {
      // on delete cascade
      bd.tarefas = bd.tarefas.filter((t) => !ids.has(t.registo_id));
      bd.equipamentos = bd.equipamentos.filter((e) => !ids.has(e.registo_id));
    }
    alvo.forEach((l) => historico(this.tabela, "DELETE", l, null));
    gravarBD();
    avisarOutros(this.tabela);
    return this.devolver ? copia(alvo) : null;
  }
}

// ---------- Login a fingir ----------
const lerSessao = () => {
  try { return JSON.parse(localStorage.getItem(CHAVE_SESSAO)); } catch { return null; }
};
let sessao = lerSessao();
const ouvintesAuth = [];
function quemSou() {
  return sessao?.user?.email || "sistema";
}
function mudarSessao(nova, evento) {
  sessao = nova;
  if (nova) localStorage.setItem(CHAVE_SESSAO, JSON.stringify(nova));
  else localStorage.removeItem(CHAVE_SESSAO);
  ouvintesAuth.forEach((f) => f(evento, sessao));
}

const auth = {
  async signInWithPassword({ email }) {
    if (!email) return { data: null, error: { message: "Escreve um email." } };
    mudarSessao({ user: { id: email.toLowerCase(), email } }, "SIGNED_IN");
    return { data: { session: sessao }, error: null };
  },
  async signOut() {
    mudarSessao(null, "SIGNED_OUT");
    return { error: null };
  },
  async getSession() {
    return { data: { session: sessao }, error: null };
  },
  onAuthStateChange(f) {
    ouvintesAuth.push(f);
    setTimeout(() => f("INITIAL_SESSION", sessao), 0);
    return { data: { subscription: { unsubscribe: () => ouvintesAuth.splice(ouvintesAuth.indexOf(f), 1) } } };
  },
};

// ---------- Tempo real entre separadores do mesmo browser ----------
const canais = new Set();
function mudancaNoutroSeparador(tabela) {
  bd = lerBD();
  canais.forEach((c) => c.ouvintes.filter((o) => !o.tabela || o.tabela === tabela).forEach((o) => o.f({ table: tabela })));
}
canalBrowser?.addEventListener("message", (e) => mudancaNoutroSeparador(e.data.tabela));
window.addEventListener("storage", (e) => e.key === CHAVE_DADOS && !canalBrowser && mudancaNoutroSeparador());

function channel() {
  const c = {
    ouvintes: [],
    on(_tipo, filtro, f) { c.ouvintes.push({ tabela: filtro?.table, f }); return c; },
    subscribe() { canais.add(c); return c; },
  };
  return c;
}

// Igual ao createClient do supabase-js (os argumentos são ignorados)
export function createClient() {
  return {
    from: (tabela) => new Pedido(tabela),
    auth,
    channel,
    removeChannel: (c) => canais.delete(c),
  };
}

// =====================================================================
// Barra do modo teste: carregar / descarregar / limpar a cópia
// =====================================================================
function barra() {
  const n = bd.registos.length;
  const info = bd.gerado_em
    ? `Cópia de ${new Date(bd.gerado_em).toLocaleString("pt-PT")} · ${n} registo(s)`
    : n ? `${n} registo(s)` : "Sem dados: carrega o ficheiro dados-teste.json";

  const ficheiro = Object.assign(document.createElement("input"), { type: "file", accept: ".json,application/json", hidden: true });
  ficheiro.onchange = async () => {
    const f = ficheiro.files[0];
    if (!f) return;
    try {
      const novo = JSON.parse(await f.text());
      if (!Array.isArray(novo.registos)) throw new Error("o ficheiro não tem a lista de registos.");
      if (bd.registos.length && !confirm("Substituir os dados de teste atuais por esta cópia? As alterações feitas aqui perdem-se.")) return;
      TABELAS.forEach((t) => (novo[t] = novo[t] || []));
      bd = novo;
      gravarBD();
      location.reload();
    } catch (e) {
      alert("Ficheiro inválido: " + e.message);
    }
  };

  const botao = (texto, f, titulo) => {
    const b = Object.assign(document.createElement("button"), { textContent: texto, title: titulo || "", onclick: f });
    return b;
  };
  const descarregar = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(bd, null, 1)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `dados-teste (${new Date().toISOString().slice(0, 10)}).json` });
    a.click();
    URL.revokeObjectURL(url);
  };
  const limpar = () => {
    if (!confirm("Apagar os dados de teste deste browser?")) return;
    localStorage.removeItem(CHAVE_DADOS);
    location.reload();
  };

  const div = document.createElement("div");
  div.id = "barra-teste";
  const texto = document.createElement("span");
  texto.innerHTML = `🧪 <b>MODO TESTE</b> · dados só neste browser · ${info}`;
  div.append(
    texto,
    ficheiro,
    botao("📂 Carregar cópia", () => ficheiro.click(), "Escolher o dados-teste.json exportado do Obsidian"),
    botao("💾 Descarregar", descarregar, "Guardar o estado atual dos testes num .json"),
    botao("🗑️ Limpar", limpar, "Apagar os dados de teste deste browser")
  );
  document.body.prepend(div);
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", barra);
else barra();
