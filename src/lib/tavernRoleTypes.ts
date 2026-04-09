/** 酒馆模式单轮角色配置（串行多轮 + 末轮 JSON） */

export interface TavernRoleConfig {
  id: string;
  speaker: string;
  shortLabel: string;
  /** 头像圆底色（UnoCSS 类名） */
  avatarClass: string;
  /** 该轮开始前追加的 user 提示 */
  turnUserPrompt: string;
  /** 为 true 时使用 json_object 流式输出并解析为 ReviewResult */
  jsonOutput: boolean;
}
