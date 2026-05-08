// 写作方法论模板数据（被 web 服务和 worker pipeline 共用）

export type MethodType =
  | "snowflake"
  | "three_act"
  | "four_act"
  | "webnovel_speed"
  | "romance_rhythm"
  | "short_reversal"
  | "custom";

export interface OutlineSkeletonNode {
  level: "book" | "volume" | "chapter" | "beat";
  title: string;
  summary: string;
  orderIndex: number;
}

export interface MethodologyTemplate {
  methodType: MethodType;
  name: string;
  description: string;
  outlineMetadata: {
    nodes: OutlineSkeletonNode[];
    notes?: string[];
  };
  reviewCriteria: {
    structureChecks: string[];
    pacingChecks: string[];
    forbiddenMoves: string[];
  };
}

export function getMethodologyTemplate(methodType: MethodType): MethodologyTemplate {
  const tmpl = TEMPLATES[methodType];
  if (!tmpl) {
    throw new Error(`未知方法论类型：${methodType}`);
  }
  return tmpl;
}

export function listMethodologyTemplates(): MethodologyTemplate[] {
  return Object.values(TEMPLATES).filter((t): t is MethodologyTemplate => t !== undefined);
}

const SNOWFLAKE: MethodologyTemplate = {
  methodType: "snowflake",
  name: "雪花写作法",
  description: "Randy Ingermanson 提出的从一句话到全书的渐进式扩展法。先卖点一句话，再扩展段落、再扩展章节。",
  outlineMetadata: {
    nodes: [
      { level: "book", title: "一句话卖点", summary: "用一句话概括全书核心冲突", orderIndex: 0 },
      { level: "book", title: "一段话扩展", summary: "扩展为五句：开局、第一推力、第二推力、危机、结局", orderIndex: 1 },
      { level: "book", title: "角色总览", summary: "为每个主要角色写一段独立小传", orderIndex: 2 },
      { level: "volume", title: "卷一框架", summary: "把一段话扩展为一页", orderIndex: 3 },
      { level: "volume", title: "卷一详细", summary: "把每句扩展为一页", orderIndex: 4 },
      { level: "chapter", title: "章节列表", summary: "列出每章的目标和爽点", orderIndex: 5 }
    ],
    notes: ["先发散再收敛", "每一步都是上一步的扩展，不要跳级"]
  },
  reviewCriteria: {
    structureChecks: ["每章是否对应到上层段落？", "结局是否回应一句话卖点？"],
    pacingChecks: ["扩展是否过度，导致冗长？"],
    forbiddenMoves: ["跳过卖点直接写细节", "角色目标与一句话卖点矛盾"]
  }
};

const THREE_ACT: MethodologyTemplate = {
  methodType: "three_act",
  name: "三幕式",
  description: "经典三幕结构：建立、对抗、解决。约占 25% / 50% / 25% 的篇幅。",
  outlineMetadata: {
    nodes: [
      { level: "volume", title: "第一幕：建立", summary: "设置世界、引入主角、激励事件", orderIndex: 0 },
      { level: "beat", title: "激励事件", summary: "打破日常的关键事件", orderIndex: 1 },
      { level: "beat", title: "第一情节点", summary: "主角进入新世界", orderIndex: 2 },
      { level: "volume", title: "第二幕：对抗", summary: "冲突升级、中点反转、低谷", orderIndex: 3 },
      { level: "beat", title: "中点", summary: "重大转折，目标修正", orderIndex: 4 },
      { level: "beat", title: "第二情节点", summary: "全面失败或最低点", orderIndex: 5 },
      { level: "volume", title: "第三幕：解决", summary: "高潮、解决、回归", orderIndex: 6 },
      { level: "beat", title: "高潮", summary: "主角与对手最终对决", orderIndex: 7 },
      { level: "beat", title: "解决", summary: "结局与新平衡", orderIndex: 8 }
    ]
  },
  reviewCriteria: {
    structureChecks: ["激励事件是否在第一幕末出现？", "中点是否真的反转了局面？", "高潮是否回应主线问题？"],
    pacingChecks: ["第二幕是否过度铺陈，导致拖沓？"],
    forbiddenMoves: ["第一幕过长", "高潮缺乏铺垫"]
  }
};

const FOUR_ACT: MethodologyTemplate = {
  methodType: "four_act",
  name: "四幕式",
  description: "起承转合四幕结构。每幕约占 25% 篇幅，「转」在第三幕，反转最强。",
  outlineMetadata: {
    nodes: [
      { level: "volume", title: "起", summary: "建立世界与主角，埋下伏笔", orderIndex: 0 },
      { level: "volume", title: "承", summary: "冲突展开，角色关系深化", orderIndex: 1 },
      { level: "volume", title: "转", summary: "重大反转，原认知被打破", orderIndex: 2 },
      { level: "volume", title: "合", summary: "回应伏笔，最终解决", orderIndex: 3 }
    ]
  },
  reviewCriteria: {
    structureChecks: ["「转」是否产生认知颠覆？", "「合」是否回收主要伏笔？"],
    pacingChecks: ["四幕篇幅是否大致均衡？"],
    forbiddenMoves: ["「转」放在末尾导致仓促", "「合」遗留过多伏笔"]
  }
};

const WEBNOVEL_SPEED: MethodologyTemplate = {
  methodType: "webnovel_speed",
  name: "网文爽点节奏",
  description: "起点/番茄风格：每 3 章一爽点，每 10 章一卷小高潮，章末必留钩子。",
  outlineMetadata: {
    nodes: [
      { level: "chapter", title: "建立打脸钩", summary: "本章末留下打脸/装逼钩子", orderIndex: 0 },
      { level: "chapter", title: "兑现爽点", summary: "前面铺垫的爽点必须在 3 章内兑现", orderIndex: 1 },
      { level: "chapter", title: "新冲突注入", summary: "爽完立刻引入新冲突，不留空白", orderIndex: 2 }
    ],
    notes: ["每 3 章必有 1 个明确爽点", "章末必留钩子", "爽点：装逼、打脸、升级、获得资源"]
  },
  reviewCriteria: {
    structureChecks: ["本章是否有爽点或钩子？", "爽点对应的铺垫是否清晰？"],
    pacingChecks: ["是否超过 3 章未兑现爽点？", "本章是否过于冗长（超过 4000 字）？"],
    forbiddenMoves: ["纯铺垫无爽点", "章末无钩子", "强行降智反派"]
  }
};

const ROMANCE_RHYTHM: MethodologyTemplate = {
  methodType: "romance_rhythm",
  name: "言情感情线节奏",
  description: "晋江风格感情线：相遇 → 误会 → 心动 → 阻碍 → 表白 → HE/BE。每阶段必须有标志事件。",
  outlineMetadata: {
    nodes: [
      { level: "beat", title: "初遇", summary: "男女主第一次见面，留下印象点", orderIndex: 0 },
      { level: "beat", title: "重逢/误会", summary: "再次相遇，制造误会或冲突", orderIndex: 1 },
      { level: "beat", title: "心动", summary: "情绪暗流涌动，但未承认", orderIndex: 2 },
      { level: "beat", title: "外部阻碍", summary: "家庭、身份、过去的阻碍", orderIndex: 3 },
      { level: "beat", title: "高甜片段", summary: "感情升温的关键场景", orderIndex: 4 },
      { level: "beat", title: "决裂/危机", summary: "感情面临最大考验", orderIndex: 5 },
      { level: "beat", title: "表白/和解", summary: "终于说出真心，确定关系", orderIndex: 6 }
    ]
  },
  reviewCriteria: {
    structureChecks: ["心动节点是否有具体场景？", "阻碍是否有真实动机，而非工具化误会？"],
    pacingChecks: ["甜段与虐段是否交替，避免单调？"],
    forbiddenMoves: ["靠强行降智维持误会", "感情突变缺铺垫", "工具人女配/男配"]
  }
};

const SHORT_REVERSAL: MethodologyTemplate = {
  methodType: "short_reversal",
  name: "短篇反转故事",
  description: "短篇结构：常态 → 异常 → 升级 → 反转 → 余韵。反转必须早有伏笔。",
  outlineMetadata: {
    nodes: [
      { level: "beat", title: "常态", summary: "建立世界与主角的日常", orderIndex: 0 },
      { level: "beat", title: "异常", summary: "出现一个不寻常的细节或事件", orderIndex: 1 },
      { level: "beat", title: "升级", summary: "异常逐步加剧，主角介入", orderIndex: 2 },
      { level: "beat", title: "反转", summary: "真相揭露，颠覆认知", orderIndex: 3 },
      { level: "beat", title: "余韵", summary: "留给读者思考的尾声", orderIndex: 4 }
    ],
    notes: ["反转必须埋伏笔，不能凭空出现"]
  },
  reviewCriteria: {
    structureChecks: ["反转是否有至少 2 处铺垫？", "余韵是否引发再读欲望？"],
    pacingChecks: ["前半部分是否过长，导致反转压缩？"],
    forbiddenMoves: ["反转缺铺垫", "结尾过度解释，破坏余韵"]
  }
};

const TEMPLATES: Record<MethodType, MethodologyTemplate | undefined> = {
  snowflake: SNOWFLAKE,
  three_act: THREE_ACT,
  four_act: FOUR_ACT,
  webnovel_speed: WEBNOVEL_SPEED,
  romance_rhythm: ROMANCE_RHYTHM,
  short_reversal: SHORT_REVERSAL,
  custom: undefined
};
