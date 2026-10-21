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
  tenant: "织云企礼",
};

export const conversations: Conversation[] = [
  {
    id: "c1",
    contactName: "陈雨晴",
    contactMeta: "企业客户 · 市场",
    preview: "报价能不能写进合同？违约金怎么定？",
    status: "waiting_human",
    handlingMode: "human",
    assignee: "林晓",
    updatedAt: "11:42",
    unread: true,
  },
  {
    id: "c2",
    contactName: "王浩",
    contactMeta: "企业客户 · 行政",
    preview: "打样费能不能免？以前的供应商不收。",
    status: "in_progress",
    handlingMode: "human",
    assignee: "林晓",
    updatedAt: "11:18",
    unread: false,
  },
  {
    id: "c3",
    contactName: "赵明远",
    contactMeta: "企业客户 · 行政",
    preview: "200 个杯子能不能印单色 logo？",
    status: "open",
    handlingMode: "ai",
    assignee: null,
    updatedAt: "10:55",
    unread: true,
  },
  {
    id: "c4",
    contactName: "周思雨",
    contactMeta: "企业客户 · 行政",
    preview: "能不能先出效果图再付定金？",
    status: "open",
    handlingMode: "ai",
    assignee: null,
    updatedAt: "昨天",
    unread: false,
  },
  {
    id: "c5",
    contactName: "李晨",
    contactMeta: "企业客户 · 市场",
    preview: "这次 logo 能指定潘通色吗？",
    status: "in_progress",
    handlingMode: "human",
    assignee: "林晓",
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
      content: "你好，这份报价能不能写进合同？违约金怎么定？",
      createdAt: "11:38",
    },
    {
      id: "m2",
      conversationId: "c1",
      sender: "system",
      content: "会话已接入 · 企业微信模拟连接",
      createdAt: "11:38",
    },
    {
      id: "m3",
      conversationId: "c1",
      sender: "customer",
      content: "我们要对公签，合同里得写清交期和色差责任。",
      createdAt: "11:40",
    },
  ],
  c2: [
    {
      id: "m4",
      conversationId: "c2",
      sender: "customer",
      content: "打样费能不能免？我们以前的供应商不收打样费。",
      createdAt: "11:05",
    },
    {
      id: "m5",
      conversationId: "c2",
      sender: "agent",
      content:
        "电子效果图不收费。实物打样马克杯 80 元/款，同款订单满起订量后可抵货款。",
      createdAt: "11:12",
    },
    {
      id: "m6",
      conversationId: "c2",
      sender: "customer",
      content: "那我先要效果图，先不打实物样。",
      createdAt: "11:18",
    },
  ],
  c3: [
    {
      id: "m7",
      conversationId: "c3",
      sender: "customer",
      content: "公司年会想订 200 个陶瓷杯，能不能印单色 logo？",
      createdAt: "10:55",
    },
  ],
  c4: [
    {
      id: "m8",
      conversationId: "c4",
      sender: "customer",
      content: "能不能先出效果图再付定金？",
      createdAt: "昨天 18:20",
    },
  ],
  c5: [
    {
      id: "m9",
      conversationId: "c5",
      sender: "customer",
      content: "去年那批杯子颜色偏了，这次 logo 能指定潘通色吗？",
      createdAt: "昨天 14:40",
    },
    {
      id: "m10",
      conversationId: "c5",
      sender: "agent",
      content: "可以。请提供潘通色号，我们会标在效果图里再给您确认。",
      createdAt: "昨天 14:52",
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
        documentTitle: "定金、开票与合同",
        quote:
          "单笔超过 5000 元或需对公合同时，由商务出具合同。自动回复不承诺具体违约金比例。",
      },
    ],
  },
  c3: {
    id: "d2",
    conversationId: "c3",
    status: "pending",
    content:
      "可以。陶瓷马克杯单色丝印起订 100 个，200 个可以做。常规交期 7 个工作日（从效果图确认并付定金起算）。请提供矢量 logo。",
    citations: [
      {
        documentTitle: "起订量与印制工艺",
        quote:
          "陶瓷马克杯单色丝印起订 100 个。200 个可以做。常规交期 7 个工作日。",
      },
    ],
  },
};

export const knowledgeDocs: KnowledgeDoc[] = [
  {
    id: "k1",
    title: "起订量与印制工艺",
    sourceType: "faq",
    status: "ready",
    updatedAt: "2026-10-16",
    excerpt: "gift-presales-v2 · 马克杯/帆布袋/礼盒起订与工艺",
  },
  {
    id: "k2",
    title: "打样与效果图",
    sourceType: "faq",
    status: "ready",
    updatedAt: "2026-10-15",
    excerpt: "gift-presales-v2 · 效果图免费；实物打样可抵货款",
  },
  {
    id: "k3",
    title: "定金、开票与合同",
    sourceType: "faq",
    status: "ready",
    updatedAt: "2026-10-14",
    excerpt: "gift-presales-v2 · 30% 定金；合同与专票走商务",
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
    excerpt: "gift-presales-v2 · 常规交期、加急与潘通色差",
  },
];

export const wecomConnections: WecomConnection[] = [
  {
    id: "w1",
    displayName: "微信客服演示连接",
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
