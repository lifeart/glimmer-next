export function fixExportsForHMR(code: string) {
  return code.split('export const ').join('export let ');
}

export function shouldHotReloadFile(fileName: string, code: string) {
  const isProperExtension =
    fileName.endsWith('.gts') || fileName.endsWith('.gjs');
  const isNotTest = !fileName.includes('-test');
  const hasTemplateTag = code.includes('<template>');
  return isProperExtension && isNotTest && hasTemplateTag;
}

export const HMR = `
if (import.meta.hot) {
  const existingTokensToReload: string[] = [];
  const evalMap = {};
  const internalTokensToReload = existingTokensToReload.map((t) => {
    const [key, value] = t.split(':');
    evalMap[key] = value || key;
    return key;
  });
  import.meta.hot.accept((newModule) => {
    if (newModule) {
      const moduleTokens = Object.keys(newModule);
      const newTokens = moduleTokens.filter(
        (token) => !(internalTokensToReload.includes(token) || Array.from(Object.values(evalMap)).includes(token)),
      );
      if (
        newTokens.length ||
        moduleTokens.length !== internalTokensToReload.length
      ) {
        import.meta.hot?.invalidate();
      } else {
        moduleTokens.forEach((token) => {
          const oldModule = internalTokensToReload.find((t) => evalMap[t] === token);
          if (oldModule) {
            window.hotReload(eval(oldModule), newModule[token]);
          }
        });
        internalTokensToReload.length = 0;
        internalTokensToReload.push(...moduleTokens);
      }
    }
  });
}
`;
