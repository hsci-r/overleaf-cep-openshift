import { KubernetesRunner } from '/usr/local/lib/overleaf-openshift/k8s-runner/KubernetesRunner.mjs'
import { clusterApi } from '/usr/local/lib/overleaf-openshift/k8s-runner/KubernetesApi.mjs'

const config = JSON.parse(process.env.KUBERNETES_RUNNER_CONFIG)
export default new KubernetesRunner(config, clusterApi(config))
