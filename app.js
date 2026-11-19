import { createClient } from "./supabase-teste.js"; // 🧪 cópia de teste: em vez do Supabase
import { SUPABASE_URL, SUPABASE_ANON_KEY, ESTADOS, NAO_APLICAVEL, CONCLUIDO, CANCELADO, PROJETOS, POSCO } from "./config.js";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $app = document.getElementById("app");
const FECHADOS = [CONCLUIDO, CANCELADO];
const ESTADOS_TAREFA = [...ESTADOS, NAO_APLICAVEL];

// =====================================================================
// Utilitários
// =====================================================================

// Cria um elemento: el("td", { class: "x", onclick: fn }, "texto", outroEl)
function el(tag, props = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "class") e.className = v;
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const f of filhos.flat()) if (f !== null && f !== undefined && f !== false) e.append(f instanceof Node ? f : String(f));
  return e;
}

function avisar(msg) {
  const d = el("div", {}, msg);
  document.getElementById("toast").append(d);
  setTimeout(() => d.remove(), 3500);
}

const vazio = (v) => v === null || v === undefined || String(v).trim() === "";
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hoje = () => iso(new Date());
const paraDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const dias = (de, ate) => Math.round((paraDate(ate) - paraDate(de)) / 86400000);
const fmt = (s) => (s ? s.split("-").reverse().join("/") : "-");
const maisDias = (s, n) => { const d = paraDate(s); d.setDate(d.getDate() + n); return iso(d); };
// Data menos N meses (como o Luxon: 31/05 - 3 meses = 28/02)
function menosMeses(s, n) {
  const [y, m, d] = s.split("-").map(Number);
  const alvo = new Date(y, m - 1 - n, 1);
  const ultimo = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
  alvo.setDate(Math.min(d, ultimo));
  return iso(alvo);
}

function quando(data) {
  if (!data) return "Sem data";
  const n = dias(hoje(), data);
  if (n === 0) return "📍 Hoje";
  if (n === 1) return "Amanhã";
  if (n > 1) return `Daqui a ${n} dias`;
  return `⚠️ Há ${-n} dias`;
}

// =====================================================================
// Dados
// =====================================================================
let dados = { registos: [], porRegisto: new Map() };

// Lê uma tabela inteira (o Supabase devolve no máximo 1000 linhas por pedido)
async function tudo(tabela, colunas = "*") {
  const linhas = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await sb.from(tabela).select(colunas).order("id").range(de, de + 999);
    if (error) throw error;
    linhas.push(...data);
    if (data.length < 1000) return linhas;
  }
}

async function carregar() {
  const [registos, tarefas] = await Promise.all([tudo("registos"), tudo("tarefas")]);
  const porRegisto = new Map();
  tarefas.sort((a, b) => a.ordem - b.ordem).forEach((t) => {
    if (!porRegisto.has(t.registo_id)) porRegisto.set(t.registo_id, []);
    porRegisto.get(t.registo_id).push(t);
  });
  dados = { registos, porRegisto };
}

const registo = (id) => dados.registos.find((r) => r.id === id);
const tarefasDe = (r) => dados.porRegisto.get(r.id) || [];
const proj = (r) => PROJETOS[r.projeto] || { nome: r.projeto, campos: [], obrigatorios: [], urs: [] };
const feita = (t) => [CONCLUIDO, NAO_APLICAVEL].includes(t.status);
const ativos = () => dados.registos.filter((r) => !r.arquivado && r.status !== CANCELADO);
const porData = (a, b) => (a.data || "9999").localeCompare(b.data || "9999");

function progresso(r) {
  const l = tarefasDe(r);
  return l.length ? `${l.filter(feita).length}/${l.length}` : "-";
}

// Status geral calculado pelas tarefas (igual ao Obsidian). null = não mexer.
function statusGeral(lista) {
  const s = lista.map((t) => t.status || "").filter((v) => !v.includes("Cancelado"));
  if (s.length === 0) return null;
  if (s.some((v) => v.includes("Bloqueado"))) return "🚧 Bloqueado";
  if (s.some((v) => v.includes("Pendente"))) return "⏸️ Pendente";
  if (s.every((v) => v.includes("Concluído") || v.includes("Não aplicável"))) return CONCLUIDO;
  if (s.some((v) => v.includes("Em curso") || v.includes("Concluído"))) return "🔄 Em curso";
  return null;
}

// O que falta para poder arquivar (Trabalhos em atraso)
function emFalta(r) {
  const p = proj(r);
  const falta = [];
  if (r.status !== CONCLUIDO) falta.push(`Status ainda "${r.status || "sem estado"}"`);
  p.obrigatorios.forEach(([campo, nome]) => vazio(r[campo]) && falta.push(`${nome} em falta`));
  const l = tarefasDe(r);
  const porFazer = l.filter((t) => !feita(t));
  if (porFazer.length) falta.push(`Checklist incompleta (${l.length - porFazer.length}/${l.length}): ${porFazer.map((t) => t.tarefa).join(", ")}`);
  if (p.respTarefas) {
    const semResp = l.filter((t) => vazio(t.responsavel)).length;
    if (semResp) falta.push(`Checklist sem responsável em ${semResp} tarefa(s)`);
  }
  return falta;
}

// Campos ainda vazios depois do prazo antes da data (ex.: UR Sistemas 3 meses antes)
function prazosFalhados(r) {
  if (!r.data || r.data < hoje()) return [];
  return (proj(r).prazos || [])
    .map(([[campo, nome], meses]) => ({ campo, nome, limite: menosMeses(r.data, meses) }))
    .filter((x) => vazio(r[x.campo]) && x.limite <= hoje());
}

// =====================================================================
// Gravar
// =====================================================================
async function gravarRegisto(r, valores) {
  const { error } = await sb.from("registos").update(valores).eq("id", r.id);
  if (error) { avisar(`Erro ao gravar: ${error.message}`); return false; }
  Object.assign(r, valores);
  agendar();
  return true;
}

async function gravarTarefa(r, t, valores) {
  const { error } = await sb.from("tarefas").update(valores).eq("id", t.id);
  if (error) return avisar(`Erro ao gravar: ${error.message}`);
  Object.assign(t, valores);
  if ("status" in valores && r.status !== CANCELADO) {
    const novo = statusGeral(tarefasDe(r));
    if (novo && novo !== r.status) await gravarRegisto(r, { status: novo });
  }
  agendar();
}

async function arquivar(r) {
  if (await gravarRegisto(r, { arquivado: true, data_conclusao: r.data_conclusao || hoje() })) avisar(`Loja ${r.loja} arquivada.`);
}

// =====================================================================
// Atualização automática (tempo real)
// Se alguém estiver a escrever num campo, espera que saia do campo.
// =====================================================================
let temporizador, pendente = false;
const aEditar = () => {
  const a = document.activeElement;
  return a && ["INPUT", "TEXTAREA", "SELECT"].includes(a.tagName) && $app.contains(a);
};
function agendar() {
  clearTimeout(temporizador);
  temporizador = setTimeout(async () => {
    if (aEditar()) { pendente = true; return; }
    await carregar();
    render();
  }, 500);
}
document.addEventListener("focusout", () =>
  setTimeout(() => { if (pendente && !aEditar()) { pendente = false; agendar(); } }, 50)
);

// =====================================================================
// Componentes
// =====================================================================
const linkLoja = (r) => el("a", { href: `#/registo/${r.id}` }, r.loja);
const tabela = (colunas, linhas) =>
  el("table", {}, el("thead", {}, el("tr", {}, colunas.map((c) => el("th", {}, c)))), el("tbody", {}, linhas));

function seletor(opcoes, atual, onchange) {
  const lista = atual && !opcoes.includes(atual) ? [atual, ...opcoes] : opcoes;
  const s = el("select", { onchange: () => onchange(s.value) }, !atual && el("option", { value: "" }, "—"), lista.map((o) => el("option", { value: o }, o)));
  s.value = atual || "";
  return s;
}

// Campo de um registo, conforme o tipo
function campo(r, [nome, titulo, tipo]) {
  let input;
  if (tipo === "status") input = seletor(ESTADOS, r.status, (v) => gravarRegisto(r, { status: v }));
  else if (tipo === "bool") {
    input = seletor(["✅ Sim", "❌ Não"], r[nome] === true ? "✅ Sim" : r[nome] === false ? "❌ Não" : "", (v) =>
      gravarRegisto(r, { [nome]: v === "" ? null : v === "✅ Sim" })
    );
  } else {
    input = el("input", { type: tipo === "date" ? "date" : "text", value: r[nome] ?? "" });
    input.onchange = () => {
      const v = input.value.trim() || null;
      if (tipo === "date" && nome === "data_conclusao" && v && v > hoje()) {
        input.value = r[nome] ?? "";
        return avisar("A data de conclusão não pode ser no futuro.");
      }
      gravarRegisto(r, { [nome]: v });
    };
  }
  return el("label", {}, titulo, input);
}

// =====================================================================
// Vistas
// =====================================================================
let vistaAtual = () => {};
async function render() {
  const y = window.scrollY;
  await vistaAtual();
  window.scrollTo(0, y);
}

// ---------- Dashboard ----------
function vistaDashboard() {
  $app.replaceChildren(
    el("h1", {}, "📋 Dashboard de Acompanhamento"),
    cartaoNovo(),
    el("div", { class: "grelha", style: "margin-top:1rem" }, cartaoOngoing(), cartaoSemUR(), cartaoAtraso())
  );
}

function cartaoNovo() {
  const proj_ = seletor(Object.keys(PROJETOS), "", () => (tipo.hidden = !proj_.value || proj_.value !== "Trabalhos_Extras"));
  [...proj_.options].forEach((o) => o.value && (o.textContent = PROJETOS[o.value].nome));
  proj_.options[0].textContent = "— Projeto —";
  const loja = el("input", { type: "text", placeholder: "Nº da loja" });
  const data = el("input", { type: "date", value: hoje() });
  const tipo = el("input", { type: "text", placeholder: "Tipo de trabalho", hidden: true });
  const botao = el("button", { class: "cta" }, "➕ Criar registo");
  botao.onclick = async () => {
    const dir = proj_.value, n = loja.value.trim();
    if (!dir) return avisar("Escolhe o projeto.");
    if (!n) return avisar("Escreve o número da loja.");
    if (dados.registos.some((r) => r.projeto === dir && r.loja === n && !r.arquivado))
      return avisar(`A loja ${n} já existe em ${PROJETOS[dir].nome}.`);
    botao.disabled = true;
    try {
      const id = await criarRegisto(dir, n, data.value || hoje(), tipo.value.trim());
      avisar(`Loja ${n} criada em ${PROJETOS[dir].nome}.`);
      await carregar();
      location.hash = `#/registo/${id}`;
    } catch (e) {
      avisar(`Erro: ${e.message}`);
    } finally {
      botao.disabled = false;
    }
  };
  return el("div", { class: "cartao azul" }, el("h2", {}, "➕ Novo registo"), el("div", { class: "linha-form" }, proj_, loja, data, tipo, botao));
}

async function criarRegisto(dir, loja, data, tipo) {
  const novo = { projeto: dir, loja, data };
  if (dir === "Trabalhos_Extras") novo.tipo_trabalho = tipo || null;
  const { data: r, error } = await sb.from("registos").insert(novo).select("id").single();
  if (error) throw error;

  const { data: modelo, error: e2 } = await sb.from("modelos_checklist").select("*").eq("projeto", dir).order("ordem");
  if (e2) throw e2;
  if (modelo.length) {
    const { error: e3 } = await sb.from("tarefas").insert(
      modelo.map((m) => ({ registo_id: r.id, ordem: m.ordem, fase: m.fase, tarefa: m.tarefa, responsavel: m.responsavel }))
    );
    if (e3) throw e3;
  }
  const posco = PROJETOS[dir].posco;
  if (posco) {
    const linhas = ["pos", "sco"].flatMap((tipo) => (posco[tipo] || []).map((numero, ordem) => ({ registo_id: r.id, tipo, ordem, numero })));
    const { error: e4 } = await sb.from("equipamentos").insert(linhas);
    if (e4) throw e4;
  }
  return r.id;
}

function cartaoOngoing() {
  const limite = maisDias(hoje(), 14);
  const lista = dados.registos
    .filter((r) => !r.arquivado && !FECHADOS.includes(r.status) && r.data && (r.data <= limite || proj(r).sempre))
    .sort(porData);
  const detalhes = (r) =>
    [["ur_sistemas", "UR Sistemas"], ["ur_nagios", "UR Nagios"], ["ur", "UR"], ["pedido_zetes", "Pedido Zetes"]]
      .filter(([k]) => r[k]).map(([k, t]) => `${t}: ${r[k]}`).join(" · ") || "-";
  return el("div", { class: "cartao verde" },
    el("h2", {}, "📅 Ongoing"),
    el("p", { class: "resumo" }, `De ${fmt(hoje())} a ${fmt(limite)} · ${lista.length} trabalho(s) · Lojas Novas aparecem sempre que tenham data`),
    lista.length === 0
      ? el("p", {}, "Sem trabalhos planeados para as próximas 2 semanas.")
      : tabela(["Data", "Quando", "Projeto", "Loja", "Status", "Detalhes", "Checklist"], lista.map((r) =>
          el("tr", {}, el("td", {}, fmt(r.data)), el("td", {}, quando(r.data)), el("td", {}, proj(r).nome), el("td", {}, linkLoja(r)),
            el("td", {}, r.status), el("td", {}, detalhes(r)), el("td", {}, progresso(r)))))
  );
}

function cartaoAtraso() {
  const atrasadas = ativos().filter((r) => r.data && r.data < hoje()).map((r) => ({ r, falta: emFalta(r), prazos: [] }));
  const antecipadas = ativos()
    .map((r) => ({ r, prazos: prazosFalhados(r) }))
    .filter((x) => x.prazos.length)
    .map((x) => ({ ...x, falta: x.prazos.map((f) => `${f.nome} em falta (prazo ${fmt(f.limite)})`) }));
  const lista = [...atrasadas, ...antecipadas].sort((a, b) => porData(a.r, b.r));
  const prontas = atrasadas.filter((x) => x.falta.length === 0).length;

  return el("div", { class: "cartao vermelho" },
    el("h2", {}, "⚠️ Em atraso"),
    lista.length === 0
      ? el("p", {}, "✅ Não há trabalhos em atraso.")
      : [
          el("p", { class: "resumo" }, `${atrasadas.length} com a data ultrapassada · ${prontas} pronto(s) para arquivar · ${atrasadas.length - prontas} com coisas em falta · ${antecipadas.length} com prazos falhados antes da data`),
          tabela(["Projeto", "Loja", "Data", "Atraso", "O que falta", "Ação"], lista.map(({ r, falta, prazos }) => {
            const desde = prazos.length ? prazos.map((f) => f.limite).sort()[0] : r.data;
            const n = dias(desde, hoje());
            return el("tr", {},
              el("td", {}, proj(r).nome), el("td", {}, linkLoja(r)), el("td", {}, fmt(r.data)),
              el("td", {}, prazos.length ? `${n} dia(s) após o prazo` : `${n} dia(s)`),
              el("td", {}, falta.length ? el("ul", {}, falta.map((f) => el("li", {}, `⚠️ ${f}`))) : "✅ Tudo preenchido"),
              el("td", {}, falta.length === 0 && !prazos.length
                ? el("button", { class: "cta", onclick: () => arquivar(r) }, "📦 Arquivar")
                : el("button", { onclick: () => (location.hash = `#/registo/${r.id}`) }, "✏️ Abrir")));
          })),
        ]
  );
}

function cartaoSemUR() {
  const lista = ativos()
    .filter((r) => r.data)
    .map((r) => ({ r, falta: proj(r).urs.filter(([c]) => vazio(r[c])) }))
    .filter((x) => x.falta.length)
    .sort((a, b) => porData(a.r, b.r));
  const passados = lista.filter((x) => x.r.data < hoje()).length;

  return el("div", { class: "cartao roxo" },
    el("h2", {}, "🔖 Sem UR"),
    lista.length === 0
      ? el("p", {}, "✅ Todos os trabalhos em curso têm os URs preenchidos.")
      : [
          el("p", { class: "resumo" }, `${lista.length} trabalho(s) sem UR · ${passados} com a data já ultrapassada · escreve o UR e carrega Enter`),
          tabela(["Projeto", "Loja", "Data", "Quando", "Status", "URs em falta"], lista.map(({ r, falta }) =>
            el("tr", {},
              el("td", {}, proj(r).nome), el("td", {}, linkLoja(r)), el("td", {}, fmt(r.data)), el("td", {}, quando(r.data)), el("td", {}, r.status),
              el("td", {}, falta.map(([c, nome]) => {
                const i = el("input", { type: "text", placeholder: "preencher", style: "width:9em" });
                let gravado = false;
                const gravar = async () => {
                  const v = i.value.trim();
                  if (!v || gravado) return;
                  gravado = true;
                  if (await gravarRegisto(r, { [c]: v })) avisar(`${nome} da loja ${r.loja} gravado.`);
                };
                i.onkeydown = (e) => e.key === "Enter" && gravar();
                i.onblur = gravar;
                return el("div", {}, `⚠️ ${nome}: `, i);
              }))))),
        ]
  );
}

// ---------- Controlo de um projeto (ou Arquivo) ----------
let filtro = "";
function vistaProjeto(dir, arquivo) {
  const p = PROJETOS[dir];
  if (!p) return $app.replaceChildren(el("p", {}, "Projeto desconhecido."));
  const lista = dados.registos.filter((r) => r.projeto === dir && !!r.arquivado === arquivo).sort(porData);

  const corpo = lista.map((r) => {
    const linha = el("tr", { "data-busca": [r.loja, r.status, r.responsavel, r.ur_sistemas, r.ur_nagios, r.ur, r.tipo_trabalho].join(" ").toLowerCase() },
      el("td", {}, linkLoja(r)),
      el("td", {}, arquivo ? fmt(r.data) : campo(r, ["data", "", "date"]).lastChild),
      el("td", {}, arquivo ? r.status : seletor(ESTADOS, r.status, (v) => gravarRegisto(r, { status: v }))),
      el("td", {}, p.urs.map(([c, nome]) => el("div", {}, `${nome}: `, r[c] || el("span", { class: "etiqueta" }, "em falta")))),
      el("td", {}, r.responsavel || "-"),
      el("td", {}, progresso(r)),
      el("td", {}, arquivo
        ? [`Concluído a ${fmt(r.data_conclusao)} `, el("button", { onclick: () => gravarRegisto(r, { arquivado: false }) }, "↩️ Reabrir")]
        : r.status === CONCLUIDO && el("button", { class: "cta", onclick: () => arquivar(r) }, "📦 Arquivar"))
    );
    return linha;
  });
  const aplicarFiltro = () => corpo.forEach((l) => (l.hidden = filtro && !l.dataset.busca.includes(filtro)));
  const busca = el("input", { type: "text", placeholder: "🔎 Filtrar (loja, status, UR…)", value: filtro, oninput: () => { filtro = busca.value.toLowerCase().trim(); aplicarFiltro(); } });
  aplicarFiltro();

  $app.replaceChildren(
    el("h1", {}, `${p.nome} – ${arquivo ? "Arquivo" : "Controlo"}`),
    el("div", { class: "cartao" },
      el("div", { class: "linha-form", style: "margin-bottom:.6rem" }, busca,
        el("span", { class: "resumo" }, `${lista.length} registo(s)`),
        el("a", { href: arquivo ? `#/projeto/${dir}` : `#/arquivo/${dir}` }, arquivo ? "← Voltar ao Controlo" : "📦 Ver arquivo")),
      tabela(["Loja", "Data", "Status", "URs", "Responsável", "Checklist", ""], corpo))
  );
}

// ---------- Um registo ----------
async function vistaRegisto(id) {
  const r = registo(id);
  if (!r) return $app.replaceChildren(el("p", {}, "Registo não encontrado (pode ter sido apagado)."), el("a", { href: "#/" }, "← Dashboard"));
  const p = proj(r);

  const [{ data: equip }, { data: hist }] = await Promise.all([
    p.posco ? sb.from("equipamentos").select("*").eq("registo_id", id).order("ordem") : Promise.resolve({ data: [] }),
    sb.from("historico").select("*").eq("registo_id", id).order("quando", { ascending: false }).limit(30),
  ]);
  if (location.hash !== `#/registo/${id}`) return; // mudou de página entretanto

  const notas = el("textarea", { value: r.notas || "" });
  notas.onchange = () => gravarRegisto(r, { notas: notas.value });

  const falta = emFalta(r);
  const acoes = el("div", { class: "linha-form" },
    r.arquivado
      ? el("button", { onclick: () => gravarRegisto(r, { arquivado: false }) }, "↩️ Reabrir (tirar do arquivo)")
      : el("button", {
          class: falta.length ? "" : "cta",
          onclick: () => (falta.length === 0 || confirm(`Ainda falta:\n- ${falta.join("\n- ")}\n\nArquivar mesmo assim?`)) && arquivar(r),
        }, "📦 Arquivar"),
    el("button", {
      class: "discreto",
      onclick: async () => {
        if (!confirm(`Apagar a loja ${r.loja} de ${p.nome}? Não dá para desfazer.`)) return;
        const { error } = await sb.from("registos").delete().eq("id", r.id);
        if (error) return avisar(`Erro: ${error.message}`);
        avisar(`Loja ${r.loja} apagada.`);
        await carregar();
        location.hash = `#/projeto/${r.projeto}`;
      },
    }, "🗑️ Apagar registo"),
    r.atualizado_por && el("span", { class: "resumo" }, `Última alteração: ${r.atualizado_por}, ${new Date(r.atualizado_em).toLocaleString("pt-PT")}`)
  );

  $app.replaceChildren(
    el("p", {}, el("a", { href: `#/${r.arquivado ? "arquivo" : "projeto"}/${r.projeto}` }, `← ${p.nome}`)),
    el("h1", {}, `Loja ${r.loja} – ${p.nome}`, r.arquivado && " ", r.arquivado && el("span", { class: "etiqueta" }, "📦 Arquivado")),
    el("div", { class: "cartao" }, el("div", { class: "campos" }, p.campos.map((c) => campo(r, c))), el("div", { style: "margin-top:.8rem" }, acoes)),
    el("div", { class: "cartao verde", style: "margin-top:1rem" }, el("h2", {}, `✅ Checklist (${progresso(r)})`), checklist(r)),
    p.posco ? el("div", { class: "cartao azul", style: "margin-top:1rem" }, posco(r, equip || [])) : "",
    el("div", { class: "cartao", style: "margin-top:1rem" }, el("h2", {}, "📝 Notas"), notas),
    el("div", { class: "cartao", style: "margin-top:1rem" }, el("h2", {}, "🕓 Histórico"), historico(hist || []))
  );
}

function checklist(r) {
  const lista = tarefasDe(r);
  if (lista.length === 0) return el("p", {}, "Este registo não tem checklist.");
  const comResp = proj(r).respTarefas;
  const colunas = ["Tarefa", comResp && "Responsável", "Status", "Notas"].filter(Boolean);
  const linhas = [];
  let faseAtual = null;
  lista.forEach((t) => {
    if (t.fase && t.fase !== faseAtual) {
      faseAtual = t.fase;
      const daFase = lista.filter((x) => x.fase === t.fase);
      linhas.push(el("tr", { class: "fase" }, el("td", { colSpan: colunas.length }, `${t.fase} (${daFase.filter(feita).length}/${daFase.length})`)));
    }
    const texto = (c) => {
      const i = el("input", { type: "text", value: t[c] || "", style: "width:100%" });
      i.onchange = () => gravarTarefa(r, t, { [c]: i.value.trim() });
      return el("td", {}, i);
    };
    linhas.push(el("tr", {},
      el("td", {}, t.tarefa),
      comResp && texto("responsavel"),
      el("td", {}, seletor(ESTADOS_TAREFA, t.status, (v) => gravarTarefa(r, t, { status: v }))),
      texto("notas")));
  });
  return tabela(colunas, linhas);
}

function posco(r, equip) {
  const alterar = async (fn) => { const { error } = await fn(); if (error) avisar(`Erro: ${error.message}`); agendar(); };
  return ["pos", "sco"].map((tipo) => {
    const g = POSCO[tipo];
    const lista = equip.filter((e) => e.tipo === tipo);
    return el("div", { style: "margin-bottom:1rem" },
      el("h2", {}, `${g.titulo} (${lista.filter((e) => e.instalado).length}/${lista.length} instalados)`),
      tabela(["Número", ...g.colunas.map((c) => c[1]), ""], lista.map((e) => {
        const num = el("input", { type: "text", value: e.numero || "", style: "width:5em" });
        num.onchange = () => alterar(() => sb.from("equipamentos").update({ numero: num.value.trim() }).eq("id", e.id));
        return el("tr", {},
          el("td", {}, num),
          g.colunas.map(([c]) => {
            const cx = el("input", { type: "checkbox", checked: e[c] === true });
            cx.onchange = () => alterar(() => sb.from("equipamentos").update({ [c]: cx.checked }).eq("id", e.id));
            return el("td", {}, cx);
          }),
          el("td", {}, el("button", { title: "Retirar esta linha", onclick: () => alterar(() => sb.from("equipamentos").delete().eq("id", e.id)) }, "✖")));
      })),
      el("button", {
        style: "margin-top:.4rem",
        onclick: () => alterar(() => sb.from("equipamentos").insert({ registo_id: r.id, tipo, ordem: lista.length ? Math.max(...lista.map((e) => e.ordem)) + 1 : 0 })),
      }, `➕ Acrescentar ${tipo.toUpperCase()}`));
  });
}

const IGNORAR = ["atualizado_em", "atualizado_por", "criado_em", "id", "registo_id"];
function historico(hist) {
  if (hist.length === 0) return el("p", { class: "resumo" }, "Sem alterações registadas.");
  return tabela(["Quando", "Quem", "O quê"], hist.map((h) => {
    let oque;
    if (h.acao === "INSERT") oque = "Criou o registo";
    else if (h.acao === "DELETE") oque = "Apagou";
    else {
      const mud = Object.keys(h.depois || {}).filter((k) => !IGNORAR.includes(k) && JSON.stringify(h.antes?.[k]) !== JSON.stringify(h.depois[k]));
      const prefixo = h.tabela === "tarefas" ? `Tarefa "${h.depois.tarefa}": ` : "";
      oque = prefixo + (mud.map((k) => `${k}: ${h.antes?.[k] ?? "—"} → ${h.depois[k] ?? "—"}`).join(" · ") || "sem mudanças visíveis");
    }
    return el("tr", {}, el("td", {}, new Date(h.quando).toLocaleString("pt-PT")), el("td", {}, h.quem), el("td", {}, oque));
  }));
}

// ---------- Login ----------
function vistaLogin() {
  document.getElementById("topo").hidden = true;
  const email = el("input", { type: "email", placeholder: "email", autocomplete: "username", style: "width:100%" });
  const senha = el("input", { type: "password", placeholder: "palavra-passe", autocomplete: "current-password", style: "width:100%" });
  const entrar = el("button", { class: "cta", type: "submit", style: "width:100%" }, "Entrar");
  const form = el("form", { class: "cartao login" },
    el("h1", {}, "📋 Lidl Projetos"),
    el("p", {}, email), el("p", {}, senha), entrar,
    el("p", { class: "resumo" }, "As contas são criadas pelo administrador no Supabase."));
  form.onsubmit = async (e) => {
    e.preventDefault();
    entrar.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: senha.value });
    entrar.disabled = false;
    if (error) avisar("Email ou palavra-passe errados.");
  };
  $app.replaceChildren(form);
}

// =====================================================================
// Navegação
// =====================================================================
function menu() {
  const atual = location.hash || "#/";
  document.getElementById("menu").replaceChildren(
    el("a", { href: "#/", class: atual === "#/" ? "ativo" : "" }, "Dashboard"),
    ...Object.entries(PROJETOS).map(([dir, p]) =>
      el("a", { href: `#/projeto/${dir}`, class: atual.includes(`/${dir}`) ? "ativo" : "" }, p.nome))
  );
}

function rota() {
  const [, pagina, arg] = (location.hash.slice(1) || "/").split("/");
  menu();
  if (pagina === "projeto") vistaAtual = () => vistaProjeto(arg, false);
  else if (pagina === "arquivo") vistaAtual = () => vistaProjeto(arg, true);
  else if (pagina === "registo") vistaAtual = () => vistaRegisto(arg);
  else vistaAtual = vistaDashboard;
  window.scrollTo(0, 0);
  vistaAtual();
}

let canal = null;
async function iniciar(sessao) {
  if (!sessao) {
    if (canal) { sb.removeChannel(canal); canal = null; }
    return vistaLogin();
  }
  document.getElementById("topo").hidden = false;
  document.getElementById("utilizador").textContent = sessao.user.email;
  try {
    await carregar();
  } catch (e) {
    return $app.replaceChildren(el("p", {}, `Erro a ler os dados: ${e.message}`));
  }
  if (!canal) {
    canal = sb.channel("alteracoes")
      .on("postgres_changes", { event: "*", schema: "public", table: "registos" }, agendar)
      .on("postgres_changes", { event: "*", schema: "public", table: "tarefas" }, agendar)
      .on("postgres_changes", { event: "*", schema: "public", table: "equipamentos" }, agendar)
      .subscribe();
  }
  rota();
}

window.addEventListener("hashchange", () => sb.auth.getSession().then(({ data }) => data.session && rota()));
document.getElementById("sair").onclick = () => sb.auth.signOut();

let ultimaSessao;
sb.auth.onAuthStateChange((evento, sessao) => {
  // Só reage a entrar/sair (o refresh do token não precisa de recarregar)
  const id = sessao?.user?.id ?? null;
  if (id === ultimaSessao) return;
  ultimaSessao = id;
  setTimeout(() => iniciar(sessao), 0);
});
