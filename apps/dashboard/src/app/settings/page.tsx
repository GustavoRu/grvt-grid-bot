export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <div className="rounded-lg border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">
          Configure credentials and defaults in your <code className="text-primary">.env</code> file.
          See <code className="text-primary">.env.example</code> for reference.
        </p>
        <div className="mt-4 space-y-3 text-sm">
          <SettingRow label="Environment" value={process.env.GRVT_ENV ?? 'testnet'} />
          <SettingRow label="Bot API URL" value={process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001'} />
        </div>
      </div>
    </div>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs bg-accent px-2 py-1 rounded">{value}</span>
    </div>
  );
}
