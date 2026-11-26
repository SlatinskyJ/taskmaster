# Suggestions (#247)

Ideas for the app from anyone signed in, which the admin marks done, dismisses or sends to GitHub as an issue (spec §5.13). The rules are in `src/domain/suggestions.ts`; this module writes the `suggestions` table with its audit entries (`suggestion.created`, `.sent`, `.done`, `.dismissed`). Behind the `suggestions` launch switch: with it off every server function answers `feature_off` and writes nothing.

- `store.ts`: create, the two lists (mine: no author; the admin's: with the author's name), done and dismiss.
- `send.ts`: the admin's send. The issue text is the admin's edited preview, never the author's name, plus one fixed footer line. GitHub failing changes nothing; once the issue exists the row stores its link and the text as sent, and it is never sent again. `sending.ts` keeps a send in flight per suggestion, so a double tap or a done/dismiss meanwhile gets `busy`.
- `github.ts`: one `POST /repos/SlatinskyJ/taskmaster/issues`, no labels. It logs only the HTTP status or the error name, never the token or GitHub's answer.

## The GitHub token

`SUGGESTIONS_GITHUB_TOKEN`, a runtime secret. Without it the send is unavailable (`canSend: false`, `no_token`); everything else works.

Make it on GitHub under Settings → Developer settings → Fine-grained tokens:

- Repository access: _Only select repositories_ → this repository.
- Permissions: _Issues: Read and write_. Nothing else.

Set it in the production container's environment next to `ADMIN_PASSWORD`. Never commit it. The issues show the token's owner as their author.
