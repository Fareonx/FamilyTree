import { useI18n } from '../i18n';

export function LangSwitch() {
  const { lang, setLang, t } = useI18n();
  return (
    <div className="segmented lang" role="group" aria-label={t('language')}>
      <button className={lang === 'ru' ? 'active' : ''} onClick={() => setLang('ru')} type="button">
        RU
      </button>
      <button className={lang === 'az' ? 'active' : ''} onClick={() => setLang('az')} type="button">
        AZ
      </button>
    </div>
  );
}
