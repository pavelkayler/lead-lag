import { ConfigForm } from '../components/ConfigForm';

export function ConfigRoute({ schema, config, rpc, notify }) {
  return (
    <ConfigForm
      schema={schema}
      config={config}
      onSave={async (draft) => {
        await rpc.call('setConfig', draft);
        notify('Config saved', 'success');
      }}
    />
  );
}
