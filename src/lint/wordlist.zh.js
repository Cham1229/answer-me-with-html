// Chinese controlled writing: light-verb constructions (use the following verb directly) and empty clichés (replace with concrete facts).
export const ZH_LIGHT_VERBS = Object.freeze([
  { re: /进行(?![中时])了?([一-龥]{2})/g, label: '进行' },
  { re: /(?:加以|予以)([一-龥]{2})/g, label: '加以/予以' },
  { re: /[做作]出了?([一-龥]{2})/g, label: '做出' },
]);

export const ZH_CLICHES = Object.freeze([
  '赋能', '抓手', '闭环', '打通', '全方位', '多维度', '深度融合', '显著提升', '至关重要', '不可或缺',
  '与此同时', '综上所述', '值得注意的是', '总而言之', '众所周知', '毋庸置疑', '一站式', '底层逻辑', '颗粒度', '方法论',
]);
