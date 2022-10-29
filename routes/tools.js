/* jslint node:true, esversion:8 */
'use strict';

const express = require('express');
const asyncify = require('express-asyncify');
const Arabic = require('../lib/Arabic');

const router = asyncify(express.Router());

router.get('/index', async function (req, res, next) {
  var db = await si({ name: `${HomeDir}/.hadithdb/si` });
  global.query('SELECT id, search_chain, search_body from hadiths');
});
  
router.get('/', async function (req, res, next) {
  var result = '';
  if (req.query.s) {
    result = Arabic.toALALC(req.query.s);
    res.render('tools', {
      s: req.query.s,
      alalc: Arabic.toALALC(req.query.s),
      trans: Arabic.translateChain(req.query.s)
    });
  } else {
    res.render('tools', {
      s: null,
      alalc: null,
      trans: null
    });
  }
});

module.exports = router;

