# platform-communications

SES email hub CDK (templates, CloudFront assets, API). Archived snapshot, as-is.

This tree is a **new public commit** with no git history. The original private archive is `eulertools/platform-communications-archive`.

Hosted-zone choice uses `CDK_DEV_ACCOUNT`. Generated `cdk.context.json` was **removed**.

No contract deployments recorded in this repo.

## What was built (EN)

`platform-communications` is an AWS CDK infrastructure-as-code project for Euler Tools' "Communications Hub" — a multi-tenant email and notification platform. It provisions a communication-center stack, an assets stack (CloudFront + S3 for email templates), and an API stack (API Gateway). SES v2 holds transactional templates; S3 uploads trigger Lambda updates.

## Qué se construyó (ES)

Hub de comunicaciones (email/SES) en AWS CDK. Contexto CDK de AWS eliminado.

---

## Notice / Aviso

**Euler Tools ha cerrado. Euler Tools is closed.**

La empresa quebró. Este repositorio está archivado y no se mantiene. El software se ofrece tal cual (as is), sin garantía ni soporte. Parte del material puede ser reclamado por acreedores.

The company went bankrupt. This repository is archived and unmaintained. Software is provided as is, with no warranty and no support. Some material may be claimed by creditors.

Site: https://euler.tools  
Org: https://github.com/eulertools  
Enquiries: https://sinequix.com · https://github.com/tebayoso
