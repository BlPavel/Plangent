# Code hosts

`CodeHost` describes hosting operations; authentication and secrets belong to integrations.
The factory resolves a project's connection (including group inheritance) and hosting path
from settings or its actual origin. `code_host` selects the provider independently of the
authentication strategy. GitLab REST v4 is the first provider.

GitLab lists are paginated. Draft notes and approvals are detected on use. Review publication
uses draft notes and bulk_publish when available; existing unrelated GitLab web drafts trigger
individual publication instead. Older servers without draft notes use discussions directly.
Callbacks persist each successful remote operation before continuing.

Positions retain base/start/head SHA and both paths. Added lines carry new_line, removed
lines old_line, and context lines both coordinates, derived from the selected version's hunks.
