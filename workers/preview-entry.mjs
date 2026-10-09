import app from "vinext/server/fetch-handler";
import { handlePreviewRequest } from "./preview-policy.mjs";
export * from "vinext/server/fetch-handler";

const previewWorker = {
  fetch(request, env, ctx) {
    return handlePreviewRequest(request, (anonymous) => app.fetch(anonymous, env, ctx));
  },
};
export default previewWorker;
