// =====================================================================
// Configuração do site. É o único ficheiro que precisas de mudar no início.
// =====================================================================

// Supabase → Project Settings → API (ou "Connect"): "Project URL" e a chave "anon public".
// A chave anon pode estar no site: os dados só aparecem depois do login (regras no schema.sql).
export const SUPABASE_URL = "https://COLOCA-AQUI.supabase.co";
export const SUPABASE_ANON_KEY = "COLOCA-AQUI-A-CHAVE-ANON";

export const ESTADOS = ["⏳ Por iniciar", "🔄 Em curso", "⏸️ Pendente", "🚧 Bloqueado", "✅ Concluído", "❌ Cancelado"];
export const NAO_APLICAVEL = "➖ Não aplicável"; // só nas tarefas; conta como concluída
export const CONCLUIDO = "✅ Concluído";
export const CANCELADO = "❌ Cancelado";

// Campos que se podem mostrar/editar num registo: [propriedade, nome, tipo]
const C = {
  data: ["data", "Data", "date"],
  data_staging: ["data_staging", "Data Staging", "date"],
  status: ["status", "Status", "status"],
  responsavel: ["responsavel", "Responsável", "text"],
  ur_sistemas: ["ur_sistemas", "UR Sistemas", "text"],
  ur_nagios: ["ur_nagios", "UR Nagios", "text"],
  ur: ["ur", "UR", "text"],
  pedido_zetes: ["pedido_zetes", "Pedido Zetes", "text"],
  tipo_trabalho: ["tipo_trabalho", "Tipo de trabalho", "text"],
  regional: ["regional", "Regional", "text"],
  telemovel: ["telemovel", "Telemóvel", "text"],
  ip_lan: ["ip_lan", "IP Lan", "text"],
  lit: ["lit", "LIT", "bool"],
  ds: ["ds", "DS", "bool"],
  portas_axis: ["portas_axis", "Portas Axis", "text"],
  switch3: ["switch3", "3º Switch", "bool"],
  data_conclusao: ["data_conclusao", "Data conclusão", "date"],
};

// Um projeto por pasta do Obsidian (o id é o nome da pasta).
// obrigatorios: campos que têm de estar preenchidos para arquivar (Trabalhos em atraso)
// urs: URs verificados em "Sem UR"
// prazos: campo vazio a X meses da data da loja → entra em atraso antes da data
// sempre: aparece no Ongoing sempre que tenha data (mesmo para lá dos 14 dias)
// respTarefas: a checklist tem a coluna Responsável (e acusa "sem responsável")
export const PROJETOS = {
  ST: {
    nome: "🔧 ST",
    campos: [C.data, C.status, C.ur_sistemas, C.ur_nagios, C.responsavel],
    obrigatorios: [C.ur_sistemas, C.ur_nagios],
    urs: [C.ur_sistemas, C.ur_nagios],
    respTarefas: true,
  },
  FK: {
    nome: "🛠️ FK",
    campos: [C.data, C.status, C.ur_sistemas, C.ur_nagios, C.responsavel, C.lit, C.ds, C.portas_axis, C.switch3],
    obrigatorios: [C.ur_sistemas, C.ur_nagios],
    urs: [C.ur_sistemas, C.ur_nagios],
    respTarefas: true,
  },
  Pyramid_Rollout: {
    nome: "🚀 Pyramid Rollout",
    campos: [C.data, C.status, C.ur_sistemas, C.ur_nagios, C.responsavel],
    obrigatorios: [],
    urs: [],
  },
  Lojas_Novas_Remodelacoes: {
    nome: "🏗️ Lojas Novas/Remodelações",
    campos: [C.data, C.data_staging, C.status, C.regional, C.telemovel, C.ip_lan, C.ur_sistemas, C.ur_nagios, C.pedido_zetes, C.responsavel],
    obrigatorios: [C.ur_sistemas, C.ur_nagios, C.pedido_zetes],
    urs: [C.ur_sistemas, C.ur_nagios],
    prazos: [[C.ur_sistemas, 3], [C.pedido_zetes, 1]], // [campo, meses antes da data]
    sempre: true,
    posco: {
      pos: ["1", "2", "3", "4", "19"],
      sco: ["85", "86", "87", "88", "89", "90"],
    },
  },
  Trabalhos_Extras: {
    nome: "🤝 Trabalhos Extras",
    campos: [C.data, C.status, C.tipo_trabalho, C.ur, C.responsavel, C.data_conclusao],
    obrigatorios: [C.ur],
    urs: [C.ur],
  },
};

// Colunas de cada tabela POS/SCO: [propriedade, título]
export const POSCO = {
  pos: { titulo: "🖥️ POS", colunas: [["instalado", "Instalado"], ["confluence", "Confluence"], ["prioritario", "Prioritário"], ["nagios", "Nagios"]] },
  sco: { titulo: "🛒 SCO", colunas: [["instalado", "Instalado"], ["confluence", "Confluence"], ["master_sco", "Master SCO"], ["nagios", "Nagios"]] },
};
