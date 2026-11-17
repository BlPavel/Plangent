// Compose callbacks here so core modules never import higher-level services.
import * as shared from './core/shared';
import * as files from './core/files';
import * as integrations from './core/integrations';
import * as settings from './core/settings';
import * as projects from './core/projects';
import * as library from './core/library';
import * as agents from './core/agents';
import * as tasks from './core/tasks';
import * as workspaces from './core/workspaces';
import * as git from './core/git';
import * as preparation from './core/preparation';
import * as execution from './core/execution';
import * as review from './core/review';
import * as work from './core/work';
import * as terminals from './core/terminals';

agents.configureAgentsDependencies({ preparation, tasks, workspaces });

execution.configureExecutionDependencies({ review });

git.configureGitDependencies({ preparation, work });

library.configureLibraryDependencies({ agents, preparation, workspaces });

preparation.configurePreparationDependencies({ execution });

review.configureReviewDependencies({ work });

settings.configureSettingsDependencies({ projects });

tasks.configureTasksDependencies({ workspaces, preparation, execution });

workspaces.configureWorkspacesDependencies({ review });
