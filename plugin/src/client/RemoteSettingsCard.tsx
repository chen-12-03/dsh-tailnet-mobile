/**
 * The remote-control settings card: pairing security and device limits.
 * Registers into the `settings.plugin.item` slot the plugin-configuration
 * section renders, bound to the `remote-web-ui` settings namespace.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { PluginSettingsCard, ValueField, BooleanField } from './PluginSettingsCard.tsx'
import { CardForm, booleanField, numberField, textField, type CardActions, type CardShell, type FieldState as CardFieldState } from './settings-form.ts'

/** The remote-control fields this card edits (the namespace's full schema). */
export interface RemoteSettings {
  /** Master switch for the plugin. */
  enabled?: boolean
  /** Token lifetime in ms; the QR link dies after this. */
  tokenTtlMs?: number
  /** A device is "online" while its lastSeenAt is newer than this (ms). */
  offlineAfterMs?: number
  /** Hard cap on paired device sessions (oldest evicted when full). */
  maxDevices?: number
  /** Cookie name carrying the paired device id. */
  cookieName?: string
  /** Fence flag: whether non-loopback /api requests must carry a live paired-device cookie. */
  requirePairingForLan?: boolean
  /** Public (tunneled) base URL the QR link is built from when set. */
  publicBaseUrl?: string
  /** Mobile composer: plain Enter sends; off means Enter inserts a newline. */
  mobileEnterToSend?: boolean
  /** Tailscale Serve app capability allowed to use /m without pairing. */
  tailnetCapability?: string
  /** Whether the mobile-only LAN bridge listens on the configured port. */
  lanBridgeEnabled?: boolean
  /** Mobile-only LAN bridge port. */
  lanBridgePort?: number
  /** Explicit IPv4/CIDR allowlist for the LAN bridge. */
  lanAllowedCidrs?: string
}

/** What the remote-control card renders. */
export interface RemoteSettingsCardState extends CardShell {
  /** Master switch. */
  enabled: CardFieldState
  /** Token lifetime. */
  tokenTtlMs: CardFieldState
  /** Device offline threshold. */
  offlineAfterMs: CardFieldState
  /** Paired-device cap. */
  maxDevices: CardFieldState
  /** Device cookie name. */
  cookieName: CardFieldState
  /** LAN fence flag. */
  requirePairingForLan: CardFieldState
  /** Public (tunneled) base URL. */
  publicBaseUrl: CardFieldState
  /** Mobile composer Enter-to-send switch. */
  mobileEnterToSend: CardFieldState
  /** Tailscale Serve app capability. */
  tailnetCapability: CardFieldState
  /** LAN bridge switch. */
  lanBridgeEnabled: CardFieldState
  /** LAN bridge port. */
  lanBridgePort: CardFieldState
  /** LAN bridge address allowlist. */
  lanAllowedCidrs: CardFieldState
}

/** The registration-side face the card's slot entry injects. */
export interface RemoteSettingsCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useRemoteSettingsCard. */
    remoteSettingsCard: SnapshotStore<RemoteSettingsCardState>
  }
}

/** Bridges the `remote-web-ui` scope onto the card's staged form. */
export class RemoteSettingsCardController {
  private readonly form: CardForm<RemoteSettings>
  private readonly store: SnapshotStore<RemoteSettingsCardState>

  /** @param scope - the bound settings scope for the `remote-web-ui` namespace. */
  constructor(scope: SettingsScope<RemoteSettings>) {
    this.form = new CardForm(scope, [
      booleanField('enabled'),
      numberField('tokenTtlMs'),
      numberField('offlineAfterMs'),
      numberField('maxDevices'),
      textField('cookieName'),
      booleanField('requirePairingForLan'),
      textField('publicBaseUrl'),
      booleanField('mobileEnterToSend'),
      textField('tailnetCapability'),
      booleanField('lanBridgeEnabled'),
      numberField('lanBridgePort'),
      textField('lanAllowedCidrs'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): RemoteSettingsCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
      tokenTtlMs: this.form.field('tokenTtlMs'),
      offlineAfterMs: this.form.field('offlineAfterMs'),
      maxDevices: this.form.field('maxDevices'),
      cookieName: this.form.field('cookieName'),
      requirePairingForLan: this.form.field('requirePairingForLan'),
      publicBaseUrl: this.form.field('publicBaseUrl'),
      mobileEnterToSend: this.form.field('mobileEnterToSend'),
      tailnetCapability: this.form.field('tailnetCapability'),
      lanBridgeEnabled: this.form.field('lanBridgeEnabled'),
      lanBridgePort: this.form.field('lanBridgePort'),
      lanAllowedCidrs: this.form.field('lanAllowedCidrs'),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): RemoteSettingsCardFace {
    return { hooks: { remoteSettingsCard: this.store }, ...this.form.actions() }
  }
}

/** Props the renderer binds for the remote-control card. */
export type RemoteSettingsCardProps =
  PropsRuntime<'web-ui.plugin.item'>
  & PropsLocale<'remote'>
  & InjectFace<RemoteSettingsCardFace>

/**
 * Render the remote-control card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function RemoteSettingsCard(props: RemoteSettingsCardProps) {
  const { t } = props
  const state = props.useRemoteSettingsCard(snapshot => snapshot)
  const disabled = !state.writable
  const fieldProps = {
    overriddenLabel: t('settings.overridden'),
    resetLabel: t('settings.reset'),
    invalidLabel: t('settings.invalidNumber'),
    disabled,
  }
  return (
    <PluginSettingsCard
      t={t}
      titleKey="settings.title"
      descriptionKey="settings.description"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <BooleanField
        id="settings-remote-enabled"
        label={t('settings.enabled')}
        hint={t('settings.enabledHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.enabled}
        onEdit={(text) => { props.edit('enabled', text) }}
        onReset={() => { props.resetField('enabled') }}
      />
      <ValueField
        id="settings-remote-token-ttl"
        label={t('settings.tokenTtlMs')}
        hint={t('settings.tokenTtlMsHint')}
        numeric
        {...fieldProps}
        {...state.tokenTtlMs}
        onEdit={(text) => { props.edit('tokenTtlMs', text) }}
        onReset={() => { props.resetField('tokenTtlMs') }}
      />
      <ValueField
        id="settings-remote-offline"
        label={t('settings.offlineAfterMs')}
        hint={t('settings.offlineAfterMsHint')}
        numeric
        {...fieldProps}
        {...state.offlineAfterMs}
        onEdit={(text) => { props.edit('offlineAfterMs', text) }}
        onReset={() => { props.resetField('offlineAfterMs') }}
      />
      <ValueField
        id="settings-remote-max-devices"
        label={t('settings.maxDevices')}
        hint={t('settings.maxDevicesHint')}
        numeric
        {...fieldProps}
        {...state.maxDevices}
        onEdit={(text) => { props.edit('maxDevices', text) }}
        onReset={() => { props.resetField('maxDevices') }}
      />
      <ValueField
        id="settings-remote-cookie"
        label={t('settings.cookieName')}
        hint={t('settings.cookieNameHint')}
        {...fieldProps}
        {...state.cookieName}
        onEdit={(text) => { props.edit('cookieName', text) }}
        onReset={() => { props.resetField('cookieName') }}
      />
      <BooleanField
        id="settings-remote-fence"
        label={t('settings.requirePairingForLan')}
        hint={t('settings.requirePairingForLanHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.requirePairingForLan}
        onEdit={(text) => { props.edit('requirePairingForLan', text) }}
        onReset={() => { props.resetField('requirePairingForLan') }}
      />
      <ValueField
        id="settings-remote-public-base"
        label={t('settings.publicBaseUrl')}
        hint={t('settings.publicBaseUrlHint')}
        placeholder="https://example.trycloudflare.com"
        {...fieldProps}
        {...state.publicBaseUrl}
        onEdit={(text) => { props.edit('publicBaseUrl', text) }}
        onReset={() => { props.resetField('publicBaseUrl') }}
      />
      <BooleanField
        id="settings-remote-mobile-enter"
        label={t('settings.mobileEnterToSend')}
        hint={t('settings.mobileEnterToSendHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.mobileEnterToSend}
        onEdit={(text) => { props.edit('mobileEnterToSend', text) }}
        onReset={() => { props.resetField('mobileEnterToSend') }}
      />
      <ValueField
        id="settings-remote-tailnet-capability"
        label={t('settings.tailnetCapability')}
        hint={t('settings.tailnetCapabilityHint')}
        placeholder="example.ts.net/cap/dsh-mobile"
        {...fieldProps}
        {...state.tailnetCapability}
        onEdit={(text) => { props.edit('tailnetCapability', text) }}
        onReset={() => { props.resetField('tailnetCapability') }}
      />
      <BooleanField
        id="settings-remote-lan-bridge"
        label={t('settings.lanBridgeEnabled')}
        hint={t('settings.lanBridgeEnabledHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.lanBridgeEnabled}
        onEdit={(text) => { props.edit('lanBridgeEnabled', text) }}
        onReset={() => { props.resetField('lanBridgeEnabled') }}
      />
      <ValueField
        id="settings-remote-lan-bridge-port"
        label={t('settings.lanBridgePort')}
        hint={t('settings.lanBridgePortHint')}
        numeric
        placeholder="3081"
        {...fieldProps}
        {...state.lanBridgePort}
        onEdit={(text) => { props.edit('lanBridgePort', text) }}
        onReset={() => { props.resetField('lanBridgePort') }}
      />
      <ValueField
        id="settings-remote-lan-allowed-cidrs"
        label={t('settings.lanAllowedCidrs')}
        hint={t('settings.lanAllowedCidrsHint')}
        placeholder="192.168.1.0/24"
        {...fieldProps}
        {...state.lanAllowedCidrs}
        onEdit={(text) => { props.edit('lanAllowedCidrs', text) }}
        onReset={() => { props.resetField('lanAllowedCidrs') }}
      />
    </PluginSettingsCard>
  )
}
