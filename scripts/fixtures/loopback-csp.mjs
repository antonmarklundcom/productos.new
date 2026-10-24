/** Transport adaptation for the isolated HTTP fixture, never deployment code.
 * WebKit upgrades loopback HTTP under UIR, unlike Chromium/Firefox:
 * https://bugs.webkit.org/show_bug.cgi?id=250776
 * Production stays HTTPS with the complete original CSP. All other fixture
 * directives retain their original bytes and outbound requests stay blocked.
 */
export function adaptHttpLoopbackCsp(headers, external) {
 const url=external instanceof URL ? external : new URL(external);
 if(url.protocol!=="http:" || url.hostname!=="127.0.0.1")return headers;
 for(const name of ["content-security-policy","content-security-policy-report-only"]){
  const policy=headers.get(name);
  if(policy===null)continue;
  const directives=policy.split(";"),remaining=directives.filter(value=>value.trim().toLowerCase()!=="upgrade-insecure-requests");
  if(remaining.length!==directives.length)headers.set(name,remaining.join(";"));
 }
 return headers;
}
