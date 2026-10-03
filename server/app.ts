import { createApiServer, type HttpOptions } from './http/router.js';
import { SourceRegistry, RuntimeDataAdapter } from './data/sources.js';

/** Production data factory: isolated uploads and verified owner-configured connectors per session. */
export function createApplication(options:Omit<HttpOptions,'createAdapter'> & {registry?:SourceRegistry;importLocale?:'en-US'|'de-DE'}) {
  const {registry=new SourceRegistry(),importLocale='en-US',...http}=options;
  return createApiServer({...http,dataImplemented:true,
    createAdapter:context=>new RuntimeDataAdapter(context,registry,importLocale)});
}
