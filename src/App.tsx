import { useState, useEffect } from 'react';
import { ImageWidget } from './components/ImageWidget/ImageWidget';
import { ImageWidgetConfiguration } from './components/ImageWidgetConfiguration/ImageWidgetConfiguration';
import { ImageWidgetEnvelope, ImageWidgetUIConfig, DataEntry, WidgetEvent } from './iosense-sdk/types';
import { validateSSOToken } from './iosense-sdk/api';
import { resolve } from './iosense-sdk/mini-engine';
import '@faclon-labs/design-sdk/styles.css';
import './App.css';

const EMPTY_UI_CONFIG: ImageWidgetUIConfig = {
  defaultImage: '',
  defaultWidth: 0,
  defaultHeight: 0,
  linkConfig: { enabled: false, url: '' },
  events: [],
  style: { card: { wrapInCard: false, bg: '' } },
};

export default function App() {
  const [envelope, setEnvelope] = useState<ImageWidgetEnvelope | undefined>(undefined);
  const [data, setData] = useState<DataEntry[]>([]);
  const [auth, setAuth] = useState<string>(localStorage.getItem('bearer_token') ?? '');
  const [timeOverride, setTimeOverride] = useState<{ startTime: number; endTime: number } | undefined>(undefined);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ssoToken = params.get('token');
    if (ssoToken && !auth) {
      validateSSOToken(ssoToken)
        .then((jwt) => {
          if (jwt) {
            localStorage.setItem('bearer_token', jwt);
            setAuth(jwt);
            const url = new URL(window.location.href);
            url.searchParams.delete('token');
            window.history.replaceState({}, '', url.toString());
          }
        })
        .catch(console.error);
    }
  }, []);

  useEffect(() => {
    if (!envelope || !auth) return;
    console.log('[App] resolving envelope:', envelope.dynamicBindingPathList, 'override:', timeOverride);
    resolve(envelope, { authentication: auth, override: timeOverride }).then(({ data: resolved }) => {
      console.log('[App] resolved data:', resolved);
      setData(resolved);
    });
  }, [envelope, auth, timeOverride]);

  function handleEvent(event: WidgetEvent) {
    console.log('[Widget Event]', event);
    if (event.type === 'TIME_CHANGE') {
      setTimeOverride({
        startTime: Number(event.payload.startTime),
        endTime: Number(event.payload.endTime),
      });
    }
  }

  function handleConfigureClick() {
    // Trigger the configurator's first FileUpload (Default Image Config) hidden file input.
    const input = document.querySelector<HTMLInputElement>(
      '.app__config .fds-file-upload input[type="file"]',
    );
    input?.click();
  }

  return (
    <div className="app">
      <div className="app__config">
        <ImageWidgetConfiguration config={envelope} authentication={auth} onChange={setEnvelope} />
      </div>
      <div className="app__widget">
        <ImageWidget
          config={envelope?.uiConfig ?? EMPTY_UI_CONFIG}
          data={data}
          onEvent={handleEvent}
          onConfigureClick={handleConfigureClick}
        />
      </div>
    </div>
  );
}
