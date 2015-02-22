#!/usr/bin/env node

/*jshint -W016*/

"use strict";

var fs = require("fs");
var _ = require("lodash");
var Q = require("q");
/*jshint -W079*/
global.XMLHttpRequest = global.XMLHttpRequest || require("xmlhttprequest").XMLHttpRequest;
global.Promise = global.Promise || Q.Promise;
var xml2jslib = require("xml2js");
var ofx4js = require("ofx4js");

function download(url) {
  var xhr = new XMLHttpRequest();
  xhr.open("GET", url, false);
  xhr.send();
  if(xhr.status !== 200) {
    console.log("download( " + url + " ): " + xhr.statusText);
    return null;
  }
  return xhr.responseText;
}

function load(path) {
  if(!fs.existsSync(path)) {
    return {};
  }
  var data = fs.readFileSync(path, {encoding: 'utf8'});
  return JSON.parse(data);
}

function save(obj, path) {
  fs.writeFileSync(path, JSON.stringify(obj, null, '\t'));
}

function xml2js(xml) {
  var parseString = xml2jslib.parseString;
  var ret;
  parseString(xml, function(err, result) {
    if(err) {
      throw err;
    }
    ret = result;
  });
  return ret;
}


//
// cache institution list from ofxhome.com
//
function ofxhome(cacheFile) {
  function getIndex() {
    console.log("Downloading index from ofxhome.com");
    var xml = download("http://www.ofxhome.com/api.php?all=yes");
    var response = xml2js(xml);
    var ret = {};
    _.forEach(response.institutionlist.institutionid, function(value) {
      var id = value.$.id;
      ret[id] = value.$;
    });
    return ret;
  }

  function fixXml(xml) {
    xml = xml.replace(/\&(?:(?!amp;))/, "&amp;");
    return xml;
  }

  function lookup(id, name) {
    console.log("\tGetting data for " + name);
    var xml = download("http://www.ofxhome.com/api.php?lookup=" + id);
    xml = fixXml(xml);
    var response = xml2js(xml);
    var ret = response.institution;
    delete ret.$;
    ret = _.mapValues(ret, function(x) {
      if(Array.isArray(x) && x.length === 1) {
        return x[0];
      } else {
        return x;
      }
    });
    ret = _.mapValues(ret, function(x) {
      return x.$ || x;
    });
    delete ret.lastofxvalidation;
    delete ret.lastsslvalidation;
    return ret;
  }

  var index = getIndex();
  
  // update entries
  _.forEach(index, function(value, id) {
    var data = lookup(id, value.name);
    _.merge(value, data);
    save(index, cacheFile);
  });

  save(index, cacheFile);

  return index;
}


//
// caches institution list from moneydance
//
function moneydance(cacheFile) {
  function parse(data) {
    var objs = {};
    var curObj = {};
    var lines = data.split("\n");
    for(var i=0; i<lines.length; i++) {
      var line = _.trim(lines[i]);
      if(line[0] === '{') {
        curObj = {};
      } else if(line[0] === '}') {
        if(curObj.id) {
          objs[curObj.id] = curObj;
        }
      } else {
        var matches = /"([^"]+)"\s*=\s*"([^"]*)"/.exec(line);
        if(matches) {
          curObj[matches[1]] = matches[2];
        }
      }
    }
    return objs;
  }
  
  console.log("Downloading index from moneydance.com");
  var data = download("http://moneydance.com/synch/moneydance/fi2004.dict");
  var all = parse(data);
  save(all, cacheFile);
  
  return all;
}


//
// merge sources
//
function merge(cache, oh, md) {
  var filist = {};
  var profCache = {};
  
  function makeId(fi) {
    return fi.ofx + "|" + fi.fid + "|" + fi.org;
  }
  
  // save profiles
  for(var cid in cache) {
    var c = cache[cid];
    if("profile" in c) {
      profCache[makeId(c)] = c.profile;
    }
  }
  
  // later ones will override earlier ones  
  function addFi(fi) {
    if(fi.fid && fi.ofx && fi.org) {
      var id = makeId(fi);
      
      if(id in profCache) {
        fi.profile = profCache[id];
      }
      
      filist[id] = fi;
    }
  }

  for(var mid in md) {
    var m = md[mid];
    addFi({
      name: _.trim(m.fi_name),
      fid: _.trim(m.fi_id),
      org: _.trim(m.fi_org),
      ofx: _.trim(m.bootstrap_url),
    });
  }
  
  for(var oid in oh) {
    var o = oh[oid];
    
    if(o.ofxfail !== 0) {
      continue;
    }

    addFi({
      name: _.trim(o.name),
      fid: _.trim(o.fid),
      org: _.trim(o.org),
      ofx: _.trim(o.url),
    });
  }
  
  filist = _.sortBy(filist, "name");
  
  return filist;
}


function getProfile(fi, savefcn) {
  var BaseFinancialInstitutionData = ofx4js.client.impl.BaseFinancialInstitutionData;
  var OFXV1Connection = ofx4js.client.net.OFXV1Connection;
  var FinancialInstitutionImpl = ofx4js.client.impl.FinancialInstitutionImpl;

  var DefaultApplicationContext = ofx4js.client.context.DefaultApplicationContext;
  var OFXApplicationContextHolder = ofx4js.client.context.OFXApplicationContextHolder;
  OFXApplicationContextHolder.setCurrentContext(new DefaultApplicationContext("QWIN", "2300"));
  
  var bank = new BaseFinancialInstitutionData();
  bank.setFinancialInstitutionId(fi.fid);
  bank.setOrganization(fi.org);
  bank.setOFXURL(fi.ofx);
  bank.setName(fi.name);
  
  var connection = new OFXV1Connection();
  connection.setAsync(false);
  
  delete fi.profile;

  console.log("Attempting to get profile for " + fi.name);

  var service = new FinancialInstitutionImpl(bank, connection);
  return service.readProfile()
  .then(function(/*ProfileResponse*/ data) {
    fi.profile = {
      address1: data.address1,
      address2: data.address2,
      address3: data.address3,
      city: data.city,
      state: data.state,
      zip: data.zip,
      country: data.country,
      email: data.email,
      customerServicePhone: data.customerServicePhone,
      technicalSupportPhone: data.technicalSupportPhone,
      fax: data.fax,
      financialInstitutionName: data.financialInstitutionName,
      siteURL: data.siteURL,
    };
    console.log("Got profile!");
    savefcn();
  }, function(error) {
    fi.profile = {
      error: error.message
    };
    savefcn();
  });
}


function willGetProfile(fi, savefcn) {
  return function() {
    return getProfile(fi, savefcn);
  };
}

function verify(filist, savefcn) {
  var p = Promise.resolve();
  for(var id in filist) {
    var fi = filist[id];
    if(fi.profile && fi.profile.error) {// && fi.profile.error.match(/ 500| 503| 400| 403/)) {
      delete fi.profile;
    }
    if(!_.isEmpty(fi.profile)) {
      continue;
    }
    p = p.then(willGetProfile(fi, savefcn));
  }
}


//
// main
//
function main() {
  var oh = (0 ? ofxhome : load)("cache/ofxhome.json");
  var md = (0 ? moneydance : load)("cache/moneydance.json");
  
  var cache = load("filist.json");
  console.log(cache.length + " institutions");
  return;

//  var filist = [];
//  _.forEach(cache, function(fi, index) {
//    if(!fi.profile.error || !fi.profile.error.match(/500|503/)) {
//      filist.push(fi);
//    }
//  });
//  save(filist, "filist.json");
  
//  var filist = merge(cache, oh, md);
//  
  var filist = cache;
  verify(filist, function() {
    save(filist, "filist.json");
  });
}


main();
