# CSC Rahti

Follow the [main README](../README.md). Rahti uses `standard-csi` storage by default.
Create a project with description `csc_project: <project-number>` in CSC's console
and use its Copy Login Command. Choose a unique `route.host` under `.2.rahtiapp.fi`.

For [outgoing email](https://docs.csc.fi/cloud/rahti/tutorials/email/):

```yaml
extraEnv:
  OVERLEAF_EMAIL_FROM_ADDRESS: your.name@university.fi
  OVERLEAF_EMAIL_SMTP_HOST: smtp.pouta.csc.fi
  OVERLEAF_EMAIL_SMTP_PORT: "25"
  OVERLEAF_EMAIL_SMTP_SECURE: "false"
  OVERLEAF_EMAIL_SMTP_TLS_REJECT_UNAUTH: "true"
```

Check shared CPU, memory and storage quota with `oc get appliedclusterresourcequota`.
For [isolated compiles](../docs/configuration.md#isolated-kubernetes-compiles),
create another Rahti project associated with the same CSC computing project and
allow quota for its runners. In that dedicated namespace, set both default policies
`allow-from-router` and `deny-other-namespaces-access` to `ingress: []`, `egress: []`
and `policyTypes: [Ingress, Egress]`. The chart supplies runner RBAC and isolation.
