/* jslint node:true, esversion:9 */
'use strict';

const express = require('express');
const createError = require('http-errors');
const asyncify = require('express-asyncify');
const Hadith = require('../lib/Hadith');

const router = asyncify(express.Router());

router.get('/:tag', async function (req, res, next) {
  res.locals.req = req;
  res.locals.res = res;
  var tag = global.tags.find(function (val) {
    return (val.text_en == req.params.tag);
  });
  if (!tag)
    throw createError(404, `Tag '${req.params.tag}' not found`);

  var offset = 0;
  if (req.query.o)
    offset = Math.floor(parseFloat(req.query.o) / global.MAX_PER_PAGE) * global.MAX_PER_PAGE;
  var results = await Hadith.a_dbGetAllHadithsWithTag(tag.id, offset);
  results.pg = (offset / global.MAX_PER_PAGE) + 1;
  results.offset = offset;
  results.hasNext = (results.length > global.MAX_PER_PAGE);
  if (results.hasNext)
    results.pop();
  results.prevOffset = ((offset - global.MAX_PER_PAGE) < global.MAX_PER_PAGE) ? 0 : offset - global.MAX_PER_PAGE;
  results.nextOffset = offset + global.MAX_PER_PAGE;
  results.hasPrev = ((offset - global.MAX_PER_PAGE) >= 0);
  if (!results.hasNext)
    delete results.nextOffset;
  if (results.length == 0)
    throw createError(404, `Page ${results.pg} of Tag '${tag.text_en}' does not exist`);

  res.render('tag', {
    tag: tag,
    results: results
  });

});

module.exports = router;

