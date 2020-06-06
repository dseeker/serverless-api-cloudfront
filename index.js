const path = require('path');
const _ = require('lodash');
const chalk = require('chalk');
const yaml = require('js-yaml');
const fs = require('fs');

class ServerlessApiCloudFrontPlugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;

    this.hooks = {
      'before:deploy:createDeploymentArtifacts': this.createDeploymentArtifacts.bind(this),
      'aws:info:displayStackOutputs': this.printSummary.bind(this),
    };
  }

  initializeVariables() {
    if (!this.initialized) {
      const credentials = this.serverless.providers.aws.getCredentials();

      this.acmRegion = this.serverless.providers.aws.getRegion();
      const acmCredentials = Object.assign({}, credentials, { region: this.acmRegion });
      this.acm = new this.serverless.providers.aws.sdk.ACM(acmCredentials);
      this.route53 = new this.serverless.providers.aws.sdk.Route53(credentials);
      this.initialized = true;
    }
  }

  createDeploymentArtifacts() {
    this.initializeVariables();
    const baseResources = this.serverless.service.provider.compiledCloudFormationTemplate;

    const filename = path.resolve(__dirname, 'resources.yml');
    const content = fs.readFileSync(filename, 'utf-8');
    const resources = yaml.safeLoad(content, {
      filename: filename
    });

    return this.prepareResources(resources).then(() => {
      _.merge(baseResources, resources);
    })
  }

  printSummary() {
    const awsInfo = _.find(this.serverless.pluginManager.getPlugins(), (plugin) => {
      return plugin.constructor.name === 'AwsInfo';
    });

    if (!awsInfo || !awsInfo.gatheredData) {
      return;
    }

    const outputs = awsInfo.gatheredData.outputs;
    const apiDistributionDomain = _.find(outputs, (output) => {
      return output.OutputKey === 'ApiDistribution';
    });

    if (!apiDistributionDomain || !apiDistributionDomain.OutputValue) {
      return ;
    }

    this.serverless.cli.consoleLog(chalk.yellow('CloudFront domain name'));
    this.serverless.cli.consoleLog(`  ${apiDistributionDomain.OutputValue} (CNAME: ${this.fullDomainName})`);
  }

  prepareResources(resources) {
    const distributionConfig = resources.Resources.ApiDistribution.Properties.DistributionConfig;
    const dnsConfig = resources.Resources.CloudFrontDns.Properties;

    this.prepareDomain(distributionConfig, dnsConfig);
    this.prepareLogging(distributionConfig);
    this.preparePriceClass(distributionConfig);
    this.prepareOrigins(distributionConfig);
    this.prepareCookies(distributionConfig);
    this.prepareHeaders(distributionConfig);
    this.prepareQueryString(distributionConfig);
    this.prepareComment(distributionConfig);
    this.prepareWaf(distributionConfig);
    this.prepareCompress(distributionConfig);
    this.prepareMinimumProtocolVersion(distributionConfig);
    this.prepareTTL(distributionConfig);

    return this.prepareCertificate(distributionConfig);
  }

  prepareLogging(distributionConfig) {
    const loggingBucket = this.getConfig('logging.bucket', null);

    if (loggingBucket) {
      distributionConfig.Logging.Bucket = loggingBucket;
      distributionConfig.Logging.Prefix = this.getConfig('logging.prefix', '');

    } else {
      delete distributionConfig.Logging;
    }
  }

  prepareDomain(distributionConfig, dnsConfig) {
    this.fullDomainName = this.getConfig('fullDomainName', null);
    if(!this.fullDomainName) {
      throw Error('Error: fullDomainName must be provided as a parameter');
    }
    if (Array.isArray(this.fullDomainName)) {
      this.configHostName = this.fullDomainName[0].substr(this.fullDomainName.indexOf('.') + 1);
      distributionConfig.Aliases = this.fullDomainName;

      dnsConfig.HostedZoneName = `${this.configHostName}.`
      dnsConfig.RecordSets[0].Name = this.fullDomainName[0]
    } else {
      this.configHostName = this.fullDomainName.substr(this.fullDomainName.indexOf('.') + 1);
      distributionConfig.Aliases = [ this.fullDomainName ];

      dnsConfig.HostedZoneName = `${this.configHostName}.`
      dnsConfig.RecordSets[0].Name = this.fullDomainName
    }
  }

  preparePriceClass(distributionConfig) {
    const priceClass = this.getConfig('priceClass', 'PriceClass_100');
    distributionConfig.PriceClass = priceClass;
  }

  prepareOrigins(distributionConfig) {
    distributionConfig.Origins[0].OriginPath = `/${this.options.stage}`;
  }

  prepareCookies(distributionConfig) {
      const forwardCookies = this.getConfig('cookies', 'all');
      distributionConfig.DefaultCacheBehavior.ForwardedValues.Cookies.Forward = Array.isArray(forwardCookies) ? 'whitelist' : forwardCookies;
      if (Array.isArray(forwardCookies)) {
        distributionConfig.DefaultCacheBehavior.ForwardedValues.Cookies.WhitelistedNames = forwardCookies;
      }
  }

  prepareHeaders(distributionConfig) {
      const forwardHeaders = this.getConfig('headers', 'none');

      if (Array.isArray(forwardHeaders)) {
        distributionConfig.DefaultCacheBehavior.ForwardedValues.Headers = forwardHeaders;
      } else {
        distributionConfig.DefaultCacheBehavior.ForwardedValues.Headers = forwardHeaders === 'none' ? [] : ['*'];
      }
    }

  prepareQueryString(distributionConfig) {
        const forwardQueryString = this.getConfig('querystring', 'all');

        if (Array.isArray(forwardQueryString)) {
          distributionConfig.DefaultCacheBehavior.ForwardedValues.QueryString = true;
          distributionConfig.DefaultCacheBehavior.ForwardedValues.QueryStringCacheKeys = forwardQueryString;
        } else {
          distributionConfig.DefaultCacheBehavior.ForwardedValues.QueryString = forwardQueryString === 'all' ? true : false;
        }
      }

  prepareComment(distributionConfig) {
    const name = this.serverless.getProvider('aws').naming.getApiGatewayName();
    distributionConfig.Comment = `Serverless - ${name}`;
  }

  prepareCertificate(distributionConfig) {
    return this.getCertArn().then(certArn => {
      if (certArn) {
        distributionConfig.ViewerCertificate.AcmCertificateArn = certArn;
      } else {
        delete distributionConfig.ViewerCertificate;
      }
    });
  }

  prepareWaf(distributionConfig) {
    const waf = this.getConfig('waf', null);

    if (waf) {
      distributionConfig.WebACLId = waf;
    } else {
      delete distributionConfig.WebACLId;
    }
  }

  prepareCompress(distributionConfig) {
    distributionConfig.DefaultCacheBehavior.Compress = (this.getConfig('compress', false) === true) ? true : false;
  }

  prepareMinimumProtocolVersion(distributionConfig) {
    const minimumProtocolVersion = this.getConfig('minimumProtocolVersion', undefined);
    if (minimumProtocolVersion) {
      distributionConfig.ViewerCertificate.MinimumProtocolVersion = minimumProtocolVersion;
    }
  }

  prepareTTL(distributionConfig) {
    distributionConfig.DefaultCacheBehavior.DefaultTTL = this.getConfig('defaultTTL', '0');
    distributionConfig.DefaultCacheBehavior.MinTTL = this.getConfig('minTTL', '0');
  }

  getConfig(field, defaultValue) {
    return _.get(this.serverless, `service.custom.apiCloudFront.${field}`, defaultValue)
  }

  /*
   * Obtains the certification arn
   */
  getCertArn() {
    let certArn = this.getConfig('certificate', null);
    if(certArn && certArn.length > 0) {
      this.serverless.cli.log(`Selected specific certificateArn ${certArn}`);
      return Promise.resolve(certArn);
    }

    const certRequest = this.acm.listCertificates({ CertificateStatuses: ['PENDING_VALIDATION', 'ISSUED', 'INACTIVE'] }).promise();

    return certRequest.catch((err) => {
      throw Error(`Error: Could not list certificates in Certificate Manager.\n${err}`);
    }).then((data) => {
      // The more specific name will be the longest
      let nameLength = 0;
      const certificates = data.CertificateSummaryList;

      // Derive certificate from domain name
      certificates.forEach((certificate) => {
        let certificateListName = certificate.DomainName;

        // Looks for wild card and takes it out when checking
        if (certificateListName[0] === '*') {
          certificateListName = certificateListName.substr(2);
        }

        // Looks to see if the name in the list is within the given domain
        // Also checks if the name is more specific than previous ones
        if (this.configHostName.includes(certificateListName)
          && certificateListName.length > nameLength) {
          nameLength = certificateListName.length;
          certArn = certificate.CertificateArn;

        }
      });

      if (certArn == null) {
        throw Error(`Error: Could not find the certificate ${certificateName}`);
      }
      this.serverless.cli.log(`The domain ${this.configHostName} resolved to the following certificateArn: ${certArn}`);
      return certArn;
    });
  }

  upsertResourceRecordSet(domain) {
    return this.getRoute53HostedZoneId().then((route53HostedZoneId) => {
      if (!route53HostedZoneId) return null;

      const params = {
        ChangeBatch: {
          Changes: [
            {
              Action: 'UPSERT',
              ResourceRecordSet: {
                Name: this.givenDomainName,
                Type: 'A',
                AliasTarget: {
                  DNSName: domain.domainName,
                  EvaluateTargetHealth: false,
                  HostedZoneId: domain.hostedZoneId,
                },
              },
            },
          ],
          Comment: 'Record created by serverless-domain-manager',
        },
        HostedZoneId: route53HostedZoneId,
      };

      return this.route53.changeResourceRecordSets(params).promise();
    });
  }

}

module.exports = ServerlessApiCloudFrontPlugin;
