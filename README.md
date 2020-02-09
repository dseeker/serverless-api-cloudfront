# aws-serverless-api-cloudfront

## This package is based on serverless-api-cloudfront

[![serverless](http://public.serverless.com/badges/v3.svg)](http://www.serverless.com)
[![npm version](https://badge.fury.io/js/serverless-api-cloudfront.svg)](https://badge.fury.io/js/serverless-api-cloudfront)
[![MIT licensed](https://img.shields.io/badge/license-MIT-blue.svg)](https://raw.githubusercontent.com/Droplr/serverless-api-cloudfront/master/LICENSE)
[![npm downloads](https://img.shields.io/npm/dt/serverless-api-cloudfront.svg?style=flat)](https://www.npmjs.com/package/serverless-api-cloudfront)

Automatically creates properly configured AWS CloudFront distribution that routes traffic
to API Gateway as well as a Route53 A record to point to the distribution from a custom domain name.

Due to limitations of API Gateway Custom Domains, we realized that setting self-managed CloudFront distribution is much more powerful.

**:zap: Pros**

- Allows you to set-up a CloudFront distribution for your API Gateway
- Sets up a Route 53 DNS entry for the CloudFront distribution
- More CloudWatch statistics of API usage (like bandwidth metrics)
- Real world [access log](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/AccessLogs.html) - out of the box, API Gateway currently does not provide any kind of real "apache-like" access logs for your invocations
- [Web Application Firewall](https://aws.amazon.com/waf/) support - enable AWS WAF to protect your API from security threats

## Installation

```
$ npm install --save-dev aws-serverless-api-cloudfront
```

## Configuration

* FullDomainName - This is REQUIRED and is used to determine the Domain name of the CloudFront Distribution as well register the Route53 A record.
  In addition, the hostname will be extracted from the full domain name and used to find the correct certificate if the certificate ARN is not explicitly provided.
* All apiCloudFront configuration parameters are optional other than FullDomainName
* First deployment may be quite long (e.g. 30 min) as Serverless is waiting for
  CloudFormation to deploy CloudFront distribution.

```
# add in your serverless.yml

plugins:
  - aws-serverless-api-cloudfront

custom:
  apiCloudFront:
    fullDomainName:  api.my-custom-domain.com
    certificate: (Determined from fullDomainName if not present) arn:aws:acm:us-east-1:000000000000:certificate/00000000-1111-2222-3333-444444444444
    waf: 00000000-0000-0000-0000-000000000000
    compress: true
    logging:
      bucket: my-bucket.s3.amazonaws.com
      prefix: my-prefix
    cookies: none
    headers:
      - x-api-key
    querystring:
      - page
      - per_page
    priceClass: PriceClass_100
```

### Notes

* `cookies` can be *all* (default), *none* or a list that lists the cookies to whitelist
```
cookies:
  - FirstCookieName
  - SecondCookieName
```

* `headers` can be *all*, *none* (default) or a list:

```
headers: all
```

* `querystring` can be *all* (default), *none* or a list, in which case all querystring parameters are forwarded, but cache is based on the list:

```
querystring: all
```

* [`priceClass`][price-class] can be `PriceClass_All` (default), `PriceClass_100` or `PriceClass_200`:


```
priceClass: PriceClass_100 is the default
```

[price-class]: 
https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_GetDistributionConfig.html#cloudfront-GetDistributionConfig-response-PriceClass
