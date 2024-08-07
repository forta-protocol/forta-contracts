# Forta Subgraph 
The Forta subgraph is currently hosted on chainstack (both dev and production environments) and provides visibility to on-chain events around the forta protocol such as staking, rewards, node pools, etc.

## Deployment

We use [theGraph's cli](https://thegraph.com/docs/en/deploying/deploying-a-subgraph-to-studio/#deploying-a-subgraph-to-subgraph-studio) in our development and production github actions to deploy the Forta subgraph.

### Dev Deployment

The development deployment occurs on every pull request that is merged to master via a github action.

Dev subgraph url: `https://polygon-mumbai.graph-eu.p2pify.com/6dbdbeb3262ca5fa43773df1e690bd53/forta-dev`

### Production Deployment

There are two production subgraphs which we follow a [blue/green deployment pattern](https://www.redhat.com/en/topics/devops/what-is-blue-green-deployment) via a github action.

Forta-a subgraph url: `https://polygon-mainnet.graph-eu.p2pify.com/49e5eba171ac70bd41578331e4d65cfc/forta-a`

Forta-b subgraph url: `https://polygon-mainnet.graph-eu.p2pify.com/62563b45923ea9d259c5c16d1f73f804/forta-b`