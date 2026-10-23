import type {
  Conversation,
  KnowledgeDoc,
  Message,
  ReplyDraft,
  Tenant,
  User,
  WecomConnection,
} from './types.js';

export const DEMO_TENANT: Tenant = {
  id: 'tenant-demo',
  name: '杭州云帆企业礼品有限公司',
  slug: 'yunfan-gifts',
  autoSendEnabled: true,
  autoSendWindowStart: null,
  autoSendWindowEnd: null,
  autoSendTimezone: 'Asia/Shanghai',
  defaultContactPolicy: 'ai',
  aiTone: 'direct',
  aiPersona: '云帆礼品客服',
  aiSystemPrompt: '',
  aiMaxLength: 500,
};

/** 演示知识库主文档标题。已有库若不是这篇，启动时会换成企业礼品售前内容。 */
export const DEMO_CATALOG_TITLE = '企业礼赠产品与定制规则';

/** 售前知识库版本标记（写入 excerpt）。变更后启动时会重灌演示知识与会话。 */
export const DEMO_KB_VERSION = 'yunfan-enterprise-demo-v4';

export const DEMO_USER: User = {
  id: 'user-linxiao',
  email: 'agent@demo.aikefu.local',
  displayName: '林晓',
  role: 'admin',
  tenantId: DEMO_TENANT.id,
};

/** 演示客服：可进工作台与知识库，不能改成员 / AI 模型 / 渠道，也不能发布知识。 */
export const DEMO_AGENT: User = {
  id: 'user-agent-demo',
  email: 'kefu@demo.aikefu.local',
  displayName: '周可',
  role: 'agent',
  tenantId: DEMO_TENANT.id,
};

/** 演示客户：各自登录门户发消息，工作台里是不同会话。 */
export const DEMO_CUSTOMERS: User[] = [
  {
    id: 'user-customer-demo',
    email: 'customer@demo.aikefu.local',
    displayName: '林女士',
    role: 'customer',
    tenantId: DEMO_TENANT.id,
  },
  {
    id: 'user-customer-suwan',
    email: 'suwan@demo.aikefu.local',
    displayName: '苏晚',
    role: 'customer',
    tenantId: DEMO_TENANT.id,
  },
  {
    id: 'user-customer-helei',
    email: 'helei@demo.aikefu.local',
    displayName: '何磊',
    role: 'customer',
    tenantId: DEMO_TENANT.id,
  },
  {
    id: 'user-customer-mating',
    email: 'mating@demo.aikefu.local',
    displayName: '马婷',
    role: 'customer',
    tenantId: DEMO_TENANT.id,
  },
];

export const DEMO_CUSTOMER: User = DEMO_CUSTOMERS[0];

/** 演示账号密码（仅本地/种子环境）。 */
export const DEMO_PASSWORD = 'demo-password';

/** 固定盐，保证各环境种子哈希一致（密码：demo-password）。 */
export const DEMO_PASSWORD_HASH =
  'scrypt$61696b6566752d64656d6f2d73616c74$a465efd7f3e4536d054b1d4ea8c8f7d38ac8b9810a87558509a7beee1a1c461cfc9dc316a815d72e8a050ea2134de5aece59eb4df37f9211eb8df3f0cfb5185a';

export const DEMO_CONNECTION_ID = 'conn-mock-1';

/** 演示客户在渠道侧的会话键前缀（同一客户始终落到同一会话）。 */
export const DEMO_CUSTOMER_EXTERNAL_ID = 'demo-customer-portal';

/** 客户门户 ↔ 渠道会话键：`demo-customer-portal:{userId}`。 */
export function demoPortalExternalId(userId: string) {
  return `${DEMO_CUSTOMER_EXTERNAL_ID}:${userId}`;
}

/** README 演示客户：一人一会话。 */
export function createSeedConversations(): Conversation[] {
  const [lin, suwan, helei, mating] = DEMO_CUSTOMERS;
  return [
    {
      id: 'c1',
      tenantId: DEMO_TENANT.id,
      connectionId: DEMO_CONNECTION_ID,
      externalConversationId: demoPortalExternalId(lin.id),
      contactName: lin.displayName,
      contactMeta: '青禾资本 · 行政采购',
      preview: '首批 600 份员工入职礼，合同交期和验收标准怎么写？',
      status: 'waiting_human',
      handlingMode: 'human',
      contactPolicy: 'human',
      assignee: '林晓',
      updatedAt: '11:42',
      unread: true,
    },
    {
      id: 'c2',
      tenantId: DEMO_TENANT.id,
      connectionId: DEMO_CONNECTION_ID,
      externalConversationId: demoPortalExternalId(suwan.id),
      contactName: suwan.displayName,
      contactMeta: '雾凇科技 · 行政采购',
      preview: '实物样确认后下单，样品费可以抵货款吗？',
      status: 'in_progress',
      handlingMode: 'human',
      contactPolicy: 'human',
      assignee: '林晓',
      updatedAt: '11:18',
      unread: false,
    },
    {
      id: 'c3',
      tenantId: DEMO_TENANT.id,
      connectionId: DEMO_CONNECTION_ID,
      externalConversationId: demoPortalExternalId(helei.id),
      contactName: helei.displayName,
      contactMeta: '启明生物 · 综合管理部',
      preview: '年会礼盒首批 200 套，能否加印公司 logo？',
      status: 'open',
      handlingMode: 'ai',
      contactPolicy: 'ai',
      assignee: null,
      updatedAt: '10:55',
      unread: true,
    },
    {
      id: 'c4',
      tenantId: DEMO_TENANT.id,
      connectionId: DEMO_CONNECTION_ID,
      externalConversationId: demoPortalExternalId(mating.id),
      contactName: mating.displayName,
      contactMeta: '嘉禾律师事务所 · 品牌市场',
      preview: '先确认设计稿和烫金位置，再走采购审批可以吗？',
      status: 'open',
      handlingMode: 'ai',
      contactPolicy: 'ai',
      assignee: null,
      updatedAt: '昨天',
      unread: false,
    },
  ];
}

export function createSeedMessages(): Message[] {
  return [
    {
      id: 'm1',
      tenantId: DEMO_TENANT.id,
      conversationId: 'c1',
      externalMessageId: 'ext-m1',
      sender: 'customer',
      content: '你好，我们要采购 600 份员工入职礼，报价和交期可以写进合同吗？验收标准怎么约定？',
      createdAt: '11:38',
    },
    {
      id: 'm2',
      tenantId: DEMO_TENANT.id,
      conversationId: 'c1',
      sender: 'system',
      content: '演示渠道已接入 · 企业微信模拟连接（非真实企业账号）',
      createdAt: '11:38',
    },
    {
      id: 'm3',
      tenantId: DEMO_TENANT.id,
      conversationId: 'c1',
      externalMessageId: 'ext-m3',
      sender: 'customer',
      content: '我们走对公采购，合同里需要写清分批交付、到货验收和不合格品处理。',
      createdAt: '11:40',
    },
    {
      id: 'm4',
      tenantId: DEMO_TENANT.id,
      conversationId: 'c2',
      externalMessageId: 'ext-m4',
      sender: 'customer',
      content: '实物样确认后下单，样品费可以抵货款吗？我们这次预计做 300 套。',
      createdAt: '11:05',
    },
    {
      id: 'm5',
      tenantId: DEMO_TENANT.id,
      conversationId: 'c2',
      externalMessageId: 'ext-m5',
      sender: 'agent',
      content:
        '电子效果图不收费。礼盒实物打样 120 元/款，正式订单达到该款起订量后可抵货款。',
      createdAt: '11:12',
      deliveryStatus: 'sent',
    },
    {
      id: 'm6',
      tenantId: DEMO_TENANT.id,
      conversationId: 'c2',
      externalMessageId: 'ext-m6',
      sender: 'customer',
      content: '明白，我先提交 logo 和预算区间，先看电子效果图。',
      createdAt: '11:18',
    },
    {
      id: 'm7',
      tenantId: DEMO_TENANT.id,
      conversationId: 'c3',
      externalMessageId: 'ext-m7',
      sender: 'customer',
      content: '启明生物年会准备 200 套礼盒，想放保温杯和笔记本，可以定制 logo 吗？',
      createdAt: '10:55',
    },
    {
      id: 'm8',
      tenantId: DEMO_TENANT.id,
      conversationId: 'c4',
      externalMessageId: 'ext-m8',
      sender: 'customer',
      content: '采购审批需要设计稿附件，可以先出效果图，内部确认后再付定金吗？',
      createdAt: '昨天 18:20',
    },
  ];
}

export function createSeedDrafts(): ReplyDraft[] {
  return [
    {
      id: 'd1',
      tenantId: DEMO_TENANT.id,
      conversationId: 'c1',
      status: 'needs_human',
      reviewStatus: 'pending',
      reason: '涉及合同条款与违约责任，需商务确认',
      content:
        '单笔超过 5000 元或需要对公合同时，由商务出具合同，自动回复不承诺违约金条款。我先记下交期和色差要求，请商务同事跟进。',
      citations: [
        {
          documentTitle: '采购合同、开票与验收',
          quote:
            '对公采购由商务出具合同，明确交付批次、验收标准和售后处理。自动回复不承诺具体违约金比例。',
        },
      ],
    },
    {
      id: 'd2',
      tenantId: DEMO_TENANT.id,
      conversationId: 'c3',
      status: 'pending',
      reviewStatus: 'pending',
      content:
        '可以按需求组合礼盒。启明生物这批 200 套可先确认产品清单和预算，再核实各 SKU 起订量与交期。请提供 logo 矢量稿及期望到货日期。',
      citations: [
        {
          documentTitle: '企业礼赠产品与定制规则',
          quote:
            '企业礼盒可组合保温杯、笔记本、帆布袋等产品；不同 SKU 起订量和交期需分别核算。',
        },
      ],
    },
  ];
}

export function createSeedKnowledge(): KnowledgeDoc[] {
  return [
    {
      id: 'k1',
      tenantId: DEMO_TENANT.id,
      title: DEMO_CATALOG_TITLE,
      sourceType: 'faq',
      status: 'ready',
      updatedAt: '2026-10-16',
      excerpt: `${DEMO_KB_VERSION} · 企业员工礼赠、客户答谢礼盒与定制采购`,
      body: [
        'Q: 企业员工入职礼、年会礼品和客户答谢礼盒可以定制吗？',
        'A: 可根据预算、人数和使用场景组合保温杯、笔记本、帆布袋、办公用品及包装礼盒。确认方案前需提供数量、预算区间、期望到货日和收货城市。',
        'Q: 礼盒最低起订量是多少？',
        'A: 常规天地盖礼盒（含内衬）起订 50 套；帆布袋单色印制起订 200 个；陶瓷杯单色丝印起订 100 个。组合礼盒按每个 SKU 分别核算，低于起订量需商务评估。',
        'Q: 支持哪些企业标识工艺？',
        'A: 常见工艺包括丝印、热转印、烫金、击凸和局部 UV。工艺适配取决于材质、图案细节和数量；量产前提供矢量 logo，并确认电子效果图或实物样。',
        'Q: 企业采购需要准备什么信息？',
        'A: 请提供采购数量、单份预算、产品偏好、logo 矢量稿、期望到货时间、收货城市，以及是否需要对公合同和发票。方案与交期经商务核实后确认。',
        'Q: 能否承诺指定日期前送达？',
        'A: 标准交期从设计稿确认、定金到账且物料齐备后起算。旺季、定制工艺和分批交付会影响排期；未核实产能前客服不承诺固定到货日期。',
      ].join('\n'),
    },
    {
      id: 'k2',
      tenantId: DEMO_TENANT.id,
      title: '打样与效果图',
      sourceType: 'faq',
      status: 'ready',
      updatedAt: '2026-10-15',
      excerpt: `${DEMO_KB_VERSION} · 效果图免费；实物打样可抵货款`,
      body: [
        'Q: 能不能先出效果图再决定？收费吗？',
        'A: 可以。提供矢量 logo 与杯型/袋型/盒型偏好后，1 个工作日内出电子效果图，不收费。未确认效果图前不安排实物打样、不收取定金。',
        'Q: 打样费多少？能不能免？',
        'A: 实物打样：马克杯 80 元/款，帆布袋 60 元/款，礼盒 120 元/款。打样费在同款正式订单达到起订量后可全额抵货款。不支持无条件免打样费；老客户年度框架价见商务，不在自动报价范围。',
        'Q: 打样多久好？快递怎么算？',
        'A: 效果图确认后实物打样约 3–5 个工作日。打样件快递到付或到付前先付运费，正式大货运费按合同约定。',
        'Q: 必须打实物样吗？',
        'A: 单色常规位置且历史同款复购，可仅确认效果图后下单。新杯型、多色、烫金、指定潘通色建议实物打样，避免色差争议。',
      ].join('\n'),
    },
    {
      id: 'k3',
      tenantId: DEMO_TENANT.id,
      title: '采购合同、开票与验收',
      sourceType: 'faq',
      status: 'ready',
      updatedAt: '2026-10-14',
      excerpt: `${DEMO_KB_VERSION} · 30% 定金；合同与专票走商务`,
      body: [
        'Q: 能不能先出效果图，走完采购审批再付款？',
        'A: 可以。电子效果图确认后再付 30% 定金进入排产；尾款在发货前付清。定金到账后锁定交期窗口。',
        'Q: 定金能不能退？',
        'A: 效果图已确认且已付定金、尚未开印：可协商取消，已产生的打样/制版费用从定金扣除。已开印或定制件开裁后定金不退。',
        'Q: 怎么开发票？',
        'A: 可开增值税普通发票或专用发票。专票需提供企业抬头、税号、地址电话、开户行及账号，由商务核验后开具。默认随尾款或发货后开具。',
        'Q: 报价能不能写进合同？违约金怎么定？',
        'A: 企业对公采购由商务根据主体信息、采购清单和交付要求出具合同。合同应明确交付批次、验收标准、付款节点和售后处理；自动回复不承诺具体违约金比例或赔偿上限，请转人工商务确认。',
        'Q: 能不能先挂账或月结？',
        'A: 标准流程为定金 + 尾款。月结/框架协议仅适用于已签约年度客户，由商务审核授信，客服侧不能口头承诺账期。',
      ].join('\n'),
    },
    {
      id: 'k4',
      tenantId: DEMO_TENANT.id,
      title: '年度框架价（草稿）',
      sourceType: 'markdown',
      status: 'draft',
      updatedAt: '2026-10-17',
      excerpt: '年度协议价与阶梯折扣仍在商务修订…',
      body: '年度框架价与阶梯折扣修订中，暂不对外自动报价。客户询问框架价/年框时请转商务。',
    },
    {
      id: 'k5',
      tenantId: DEMO_TENANT.id,
      title: '交期、加急与色差确认',
      sourceType: 'faq',
      status: 'ready',
      updatedAt: '2026-10-17',
      excerpt: `${DEMO_KB_VERSION} · 常规交期、加急与潘通色差`,
      body: [
        'Q: 常规交期怎么算？',
        'A: 马克杯/帆布袋常规 7 个工作日，礼盒 10 个工作日，均从「效果图确认 + 定金到账」起算。打样确认日与法定节假日不计入。',
        'Q: 能不能加急？年会前一定要到？',
        'A: 视产能而定。加急需商务确认档期，可能加收加急费。自动回复不承诺「一定赶上某日」，请提供收货城市与最晚到货日转人工排期。',
        'Q: logo 能指定潘通色吗？会不会偏色？',
        'A: 可以指定潘通色号，效果图会标注色号。印刷与屏幕仍可能存在可见色差；重要品牌色建议实物打样签字确认。签字确认后的色差不作为批量返工理由，除非严重偏离签样。',
        'Q: 以前货颜色偏了，这次怎么保证？',
        'A: 请提供潘通色号或上次签样照片。我们将按新签样生产。历史订单色差责任与赔偿需商务个案处理，不在自动回复承诺范围。',
        'Q: 中秋、年会旺季交期会变吗？',
        'A: 旺季（通常提前 4–6 周）交期可能延长 3–7 个工作日，以商务锁档为准。建议尽早确认效果图并付定金占产能。',
      ].join('\n'),
    },
  ];
}

export function createSeedWecomConnections(): WecomConnection[] {
  return [
    {
      id: DEMO_CONNECTION_ID,
      tenantId: DEMO_TENANT.id,
      displayName: '微信客服模拟演示连接',
      channelType: 'wecom_mock',
      capability: 'wechat_kf',
      status: 'connected',
      lastEventAt: '今天 11:42',
    },
  ];
}
