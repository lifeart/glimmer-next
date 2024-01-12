export function fixExportsForHMR(code: string) {
  return code.split('export const ').join('export let ');
}

export function shouldHotReloadFile(fileName: string) {
  const isProperExtension =
    fileName.endsWith('.gts') || fileName.endsWith('.gjs');
  const isNotTest = !fileName.includes('-test');
  return isProperExtension && isNotTest;
}

export const HMR = `
if (import.meta.hot) {
  const existingTokensToReload: string[] = [];
  import.meta.hot.accept((newModule) => {
    if (newModule) {
      const moduleTokens = Object.keys(newModule);
      const newTokens = moduleTokens.filter(
        (token) => !existingTokensToReload.includes(token),
      );
      if (
        newTokens.length ||
        moduleTokens.length !== existingTokensToReload.length
      ) {
        import.meta.hot?.invalidate();
      } else {
        moduleTokens.forEach((token) => {
          const oldModule = existingTokensToReload.find((t) => t === token);
          if (oldModule) {
            window.hotReload(eval(oldModule), newModule[token]);
          }
        });
        existingTokensToReload.length = 0;
        existingTokensToReload.push(...moduleTokens);
      }
    }
  });
}
`;
