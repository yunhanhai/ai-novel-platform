// 评审 rubric：冻结的评分维度与锚点。
//
// 设计原则：
//   - 维度是"编辑会真实争论的点"，不是抽象形容词
//   - 锚点必须具体到可对照原文判断，避免"较好/较差"式空转
//   - 版本化：修改任何锚点必须升 EVAL_RUBRIC_VERSION，新旧分数不可直接比较
//
// 本文件只含数据，不含逻辑——它是第二期 A/B 盲测的裁判规则，进 git 冻结。

export interface RubricDimension {
  /** 机器键（评审输出的 perDimension 用它做键） */
  key: string;
  label: string;
  /** 评什么、不评什么 */
  description: string;
  /** 5 分锚点（好到什么程度） */
  anchor5: string;
  /** 1 分锚点（差到什么程度） */
  anchor1: string;
}

export const EVAL_RUBRIC_VERSION = "1";

export const EVAL_RUBRIC: RubricDimension[] = [
  {
    key: "prose",
    label: "文字质感",
    description: "只评语言本身：句式、具象度、套路密度。不评情节。",
    anchor5: "句式长短交错，用具体动作与感官细节推进，没有套话与空洞总结；删掉任何一句都有损失",
    anchor1: "句式单调重复，大量抽象总结与套话（总而言之/似乎/仿佛），像模板填空"
  },
  {
    key: "coherence",
    label: "连贯性",
    description: "章内逻辑：时间线、动作因果、场景切换是否自洽。不评与前后章的关系。",
    anchor5: "每个动作都有因果衔接，时间线无跳跃感，场景切换有过渡",
    anchor1: "动作凭空发生，时间线自相矛盾，场景切换无任何铺垫"
  },
  {
    key: "characterVoice",
    label: "人物声口",
    description: "对话与行为是否符合人物身份、性格的一致性。",
    anchor5: "对话能分辨出是谁在说，用词与身份匹配，行为有性格依据",
    anchor1: "所有人说话一个腔调，行为与既定性格冲突，像同一个模板的分身"
  },
  {
    key: "pacing",
    label: "节奏",
    description: "详略安排：紧张段落与舒缓段落的交替，信息释放速度。",
    anchor5: "张弛有度，关键场景放慢展开，过渡段落干净利落不拖沓",
    anchor1: "全程一个速度，要么流水账赶进度，要么原地打转堆细节"
  },
  {
    key: "hook",
    label: "章末钩子",
    description: "章末是否制造了让读者想读下一章的悬念或期待。",
    anchor5: "结尾有明确的新悬念或转折，且与本章内容自然相连",
    anchor1: "结尾平淡收场或强行总结，没有任何继续阅读的动力"
  }
];
