export class OutlineSourceChanged extends Error {
  constructor() { super("大纲来源已变化，已保留作者最新大纲；请核对后重新生成细纲"); }
}
