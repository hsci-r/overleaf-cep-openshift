# CSC Rahti

Follow the [main README](../README.md); no Rahti-specific chart overrides are
needed. Rahti's default StorageClass is `standard-csi`.

Create/select your project in CSC's console with its required
`csc_project: <project-number>` description and use its Copy Login Command.
Set `route.host` to a unique hostname under `.2.rahtiapp.fi`, covered by Rahti's
ingress certificate.

For outgoing email, CSC provides [`smtp.pouta.csc.fi:25`](https://docs.csc.fi/cloud/rahti/tutorials/email/)
without authentication. Set these in your values, using a valid sender address:

```yaml
smtp:
  sender: your.name@university.fi
  host: smtp.pouta.csc.fi
  port: 25
  secure: false
  verifyCertificate: true
```

Check the project-wide quota with `oc get appliedclusterresourcequota`; CPU,
memory and storage limits must include MongoDB and Redis.
