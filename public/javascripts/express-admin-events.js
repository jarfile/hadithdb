/* jslint node:true, esversion:9 */
'use strict';

const Hadith = require("../../lib/Hadith");
const SearchIndex = require("../../lib/SearchIndex");

exports.postSave = async function (req, res, args, next) {

	var rows = await global.query(`SELECT bookId FROM hadiths WHERE id=${args.id[0]}`);
	var sql = `SELECT * FROM v_hadiths WHERE bookId=${rows[0].bookId} ORDER BY h1, numInChapter`;
	rows = await global.query(sql);
	var i = rows.findIndex(function (row) {
		return (row.hId == parseInt(args.id[0]));
	});
	if (i != undefined) {

		console.log(`post processing ${args.id[0]}`);
		var data = {
			_id: rows[i].hId
		};
		if (i > 0 && rows[i].bookId == rows[i - 1].bookId)
			data.prevId = rows[i - 1].hId;
		if (i < (rows.length - 1) && rows[i].bookId == rows[i + 1].bookId)
			data.nextId = rows[i + 1].hId;
		for (var k in rows[i])
			data[k] = rows[i][k];
		console.log(`reindexed ${data.bookAlias}:${data.num}`);
		await global.searchIdx.PUT([data], SearchIndex.TOKENIZER_OPTIONS);

		console.log(`recording similar matches for ${data.bookAlias}:${data.num}`);
		await global.query(`DELETE FROM hadith_sim_candidates WHERE hadithId1=${args.id[0]} OR hadithId2=${args.id[0]}`);
		rows = await global.query(`SELECT * FROM hadiths WHERE id=${args.id[0]}`);
		var deHadith = Hadith.disemvoweledHadith(rows[0]);
		await Hadith.a_recordSimilarMatches(deHadith);
	
	}


	next();
};