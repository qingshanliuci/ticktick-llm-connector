# Classification Rules

## Marker To Class

- `待投递` -> `待行动`
- `待阅读` -> `材料`
- `好素材` -> `材料`

## Default Heuristics

- Action keywords: 会议, 讨论, 面试, 提交, 发送, 提醒, 今天, 明天.
- Material keywords: 素材, 待读, 链接, 文章, 视频, 抖音, 公众号, 转发.
- URL-heavy tasks default to `材料` unless explicitly marked as action.

## Merge Heuristic

- Scope: same project + WeChat-captured inbox tasks.
- Match marker task to nearest URL task within `window-seconds`.
- Keep URL task, delete marker task, append marker note into description.

## Safety

- Never run merge apply without preview.
- Keep thresholds configurable (`--window-seconds`).
