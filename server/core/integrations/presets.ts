import { AuthConfig } from './index';
import { AuthStrategy } from '../../models/integrations';
export interface IntegrationPreset { id: string; name: string; description: string; auth_strategy: AuthStrategy; auth_config: AuthConfig; code_host?: string }
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
}, {
  id: 'gitlab-token', code_host: 'gitlab', name: 'GitLab (токен)', description: 'GitLab API через PAT с правами api. Git настраивается отдельно.',
  auth_strategy: 'token', auth_config: { check_path: '/api/v4/user', user_path: 'name', expect_json: true, token_header: 'PRIVATE-TOKEN', token_prefix: '',
    check_details: [
      { path: '/api/v4/version', value_path: 'version', result_key: 'version', label: 'GitLab' },
      { path: '/api/v4/personal_access_tokens/self', value_path: 'expires_at', result_key: 'token_expires_at', label: 'Токен до' },
    ],
  },
}, {
  id: 'github-token', code_host: 'github', name: 'GitHub (токен)', description: 'GitHub API (github.com) через PAT с правом repo: создание Pull Request. Git настраивается отдельно.',
  auth_strategy: 'token', auth_config: { check_path: '/user', user_path: 'login', expect_json: true, token_header: 'Authorization', token_prefix: 'Bearer ',
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } },
}];
