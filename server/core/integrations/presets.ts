import { AuthConfig } from './index';
import { AuthStrategy } from '../../models/integrations';
export interface IntegrationPreset { id: string; name: string; description: string; auth_strategy: AuthStrategy; auth_config: AuthConfig }
/** Templates only: saving copies settings, never a reference to the preset. */
export const integrationPresets: readonly IntegrationPreset[] = [{
  id: 'atlassian-server-dc', name: 'Atlassian Server/DC',
  description: "Для Confluence/Jira Server и Data Center с обычной формой входа; не для Cloud и SSO. Для Jira измените путь проверки пользователя и поле имени.",
  auth_strategy: 'auto',
  auth_config: {
    check_path: '/rest/api/user/current', user_path: 'displayName', expect_json: true,
    strategies: ['basic', 'form'], login_path: '/dologin.action',
    username_field: 'os_username', password_field: 'os_password',
    fields: { os_destination: '/', login: 'Log in' }, headers: { 'X-Atlassian-Token': 'no-check' },
    invalid_password: { header: { name: 'X-Seraph-LoginReason', value: 'AUTHENTICATED_FAILED' } },
    invalid_session: { redirect_path: '/login.action*', html_instead_of_json: true },
  },
}];
