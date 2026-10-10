/** Catch alias regressions that typechecks and direct native-domain tests miss. */
export function verifyNativeSettingsBundle(serverJavaScript) {
  if (!serverJavaScript.includes("D1_SETTINGS_SAVE_MISSING_RESULT") || !serverJavaScript.includes("json_set"))
    throw new Error("Workers bundle omitted native D1 settings writes; review adapter aliases before deploying.");
}
