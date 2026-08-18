import { clientBundle, mobileBundle } from './build/tsdown.client.ts'

export default clientBundle('dsh-tailnet-mobile-plugin', ['src/index.ts', 'src/invariant.ts'], {
  libExternal: [
    /^@deepseek-ai\/dsh-host-apiproxy/,
    '@deepseek-ai/dsh-client-connection',
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-runtime',
    '@deepseek-ai/dsh-client-ui-primitives',
    '@deepseek-ai/dsh-client-ui-settings',
    '@deepseek-ai/dsh-client-ui-sidebar',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-host-webserver',
    '@deepseek-ai/dsh-invariants',
    '@deepseek-ai/dsh-settings',
  ],
  companions: [mobileBundle('dsh-tailnet-mobile-plugin', 'src/mobile/index.tsx')],
})
