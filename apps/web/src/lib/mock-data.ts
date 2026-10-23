import type {
  Conversation,
  KnowledgeDoc,
  Message,
  ReplyDraft,
  WecomConnection,
} from "./types";

export const currentUser = {
  name: "林晓",
  role: "客服人员",
  tenant: "杭州云帆企业礼品有限公司",
};

/** 与 README / API 种子一致：仅四个演示客户，一人一会话。 */
export const conversations: Conversation[] = [
  {
    id: "c1",
    contactName: "林女士",
    contactMeta: "青禾资本 · 行政采购",
    preview: "首批 600 份员工入职礼，合同交期和验收标准怎么写？",
    status: "waiting_human",
    handlingMode: "human",
    assignee: "林晓",
    updatedAt: "11:42",
    unread: true,
  },
  {
    id: "c2",
    contactName: "苏晚",
    contactMeta: "雾凇科技 · 行政采购",
    preview: "实物样确认后下单，样品费可以抵货款吗？",
    status: "in_progress",
    handlingMode: "human",
    assignee: "林晓",
    updatedAt: "11:18",
    unread: false,
  },
  {
    id: "c3",
    contactName: "何磊",
    contactMeta: "启明生物 · 综合管理部",
    preview: "年会礼盒首批 200 套，能否加印公司 logo？",
    status: "open",
    handlingMode: "ai",
    assignee: null,
    updatedAt: "10:55",
    unread: true,
  },
  {
    id: "c4",
    contactName: "马婷",
    contactMeta: "嘉禾律师事务所 · 品牌市场",
    preview: "先确认设计稿和烫金位置，再走采购审批可以吗？",
    status: "open",
    handlingMode: "ai",
    assignee: null,
    updatedAt: "昨天",
    unread: false,
  },
];

export const messagesByConversation: Record<string, Message[]> = {
  c1: [
    {
      id: "m1",
      conversationId: "c1",
      sender: "customer",
      content: "你好，我们要采购 600 份员工入职礼，报价和交期可以写进合同吗？验收标准怎么约定？",
      createdAt: "11:38",
    },
    {
      id: "m2",
      conversationId: "c1",
      sender: "system",
      content: "演示渠道已接入 · 企业微信模拟连接（非真实企业账号）",
      createdAt: "11:38",
    },
    {
      id: "m3",
      conversationId: "c1",
      sender: "customer",
      content: "我们走对公采购，合同里需要写清分批交付、到货验收和不合格品处理。",
      createdAt: "11:40",
    },
  ],
  c2: [
    {
      id: "m4",
      conversationId: "c2",
      sender: "customer",
      content: "实物样确认后下单，样品费可以抵货款吗？我们这次预计做 300 套。",
      createdAt: "11:05",
    },
    {
      id: "m5",
      conversationId: "c2",
      sender: "agent",
      content:
        "电子效果图不收费。礼盒实物打样 120 元/款，正式订单达到该款起订量后可抵货款。",
      createdAt: "11:12",
    },
    {
      id: "m6",
      conversationId: "c2",
      sender: "customer",
      content: "明白，我先提交 logo 和预算区间，先看电子效果图。",
      createdAt: "11:18",
    },
  ],
  c3: [
    {
      id: "m7",
      conversationId: "c3",
      sender: "customer",
      content: "启明生物年会准备 200 套礼盒，想放保温杯和笔记本，可以定制 logo 吗？",
      createdAt: "10:55",
    },
  ],
  c4: [
    {
      id: "m8",
      conversationId: "c4",
      sender: "customer",
      content: "采购审批需要设计稿附件，可以先出效果图，内部确认后再付定金吗？",
      createdAt: "昨天 18:20",
    },
  ],
};

export const draftsByConversation: Record<string, ReplyDraft> = {
  c1: {
    id: "d1",
    conversationId: "c1",
    status: "needs_human",
    content:
      "单笔超过 5000 元或需要对公合同时，由商务出具合同，自动回复不承诺违约金条款。我先记下交期和色差要求，请商务同事跟进。",
    citations: [
      {
        documentTitle: "采购合同、开票与验收",
        quote:
          "对公采购由商务出具合同，明确交付批次、验收标准和售后处理。自动回复不承诺具体违约金比例。",
      },
    ],
  },
  c3: {
    id: "d2",
    conversationId: "c3",
    status: "pending",
    content:
      "可以按需求组合礼盒。启明生物这批 200 套可先确认产品清单和预算，再核实各 SKU 起订量与交期。请提供 logo 矢量稿及期望到货日期。",
    citations: [
      {
        documentTitle: "企业礼赠产品与定制规则",
        quote:
          "企业礼盒可组合保温杯、笔记本、帆布袋等产品；不同 SKU 起订量和交期需分别核算。",
      },
    ],
  },
};

export const knowledgeDocs: KnowledgeDoc[] = [
  {
    id: "k1",
    title: "企业礼赠产品与定制规则",
    sourceType: "faq",
    status: "ready",
    updatedAt: "2026-10-16",
    excerpt: "yunfan-enterprise-demo-v4 · 企业员工礼赠、客户答谢礼盒与定制采购",
  },
  {
    id: "k2",
    title: "打样与效果图",
    sourceType: "faq",
    status: "ready",
    updatedAt: "2026-10-15",
    excerpt: "yunfan-enterprise-demo-v4 · 效果图免费；实物打样可抵货款",
  },
  {
    id: "k3",
    title: "采购合同、开票与验收",
    sourceType: "faq",
    status: "ready",
    updatedAt: "2026-10-14",
    excerpt: "yunfan-enterprise-demo-v4 · 30% 定金；合同与专票走商务",
  },
  {
    id: "k4",
    title: "年度框架价（草稿）",
    sourceType: "markdown",
    status: "draft",
    updatedAt: "2026-10-17",
    excerpt: "年度协议价与阶梯折扣仍在商务修订…",
  },
  {
    id: "k5",
    title: "交期、加急与色差确认",
    sourceType: "faq",
    status: "ready",
    updatedAt: "2026-10-17",
    excerpt: "yunfan-enterprise-demo-v4 · 常规交期、加急与潘通色差",
  },
];

export const wecomConnections: WecomConnection[] = [
  {
    id: "w1",
    displayName: "微信客服模拟演示连接",
    channelType: "wecom_mock",
    capability: "wechat_kf",
    status: "connected",
    lastEventAt: "今天 11:42",
  },
];

export const analyticsSummary = {
  rangeLabel: "近 7 日 · 演示数据",
  adoptionRate: "68%",
  handoffRate: "22%",
  avgResponseMin: "3.4 分钟",
  citedAnswerRate: "81%",
  notes: "指标基于演示 mock，非正式线上统计。",
};
