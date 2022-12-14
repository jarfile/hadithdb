/* jslint node:true, esversion:9 */
'use strict';

const stringSimilarity = require("string-similarity");
const Arabic = require('../lib/Arabic');
const Utils = require('./Utils');

class Hadith {

    constructor(row) {

        for (var k in row)
            this[k] = row[k];
        if (this.hId)
            this.id = this.hId;

        this.num = row.num + '';
        this.num_ar = Arabic.toArabicDigits(this.num);

        if (this.book_id != null)
            row.bookId = this.bookId = this.book_id;
        this.book = global.books.find(function (value) {
            return row.bookId == value.id;
        });

        if (this.grade_id != null)
            row.gradeId = this.gradeId = this.grade_id;
        this.grade = global.grades.find(function (value) {
            return row.gradeId == value.id;
        });

        if (this.grader_id != null)
            row.graderId = this.graderId = this.grader_id;
        this.grader = global.graders.find(function (value) {
            return row.graderId == value.id;
        });

        if (this.h1_id != null) {
            this.chapter = {
                id: this.h1_id,
                h1: this.h1,
                title_en: this.h1_title_en,
                title: this.h1_title,
                intro_en: this.h1_intro_en,
                intro: this.h1_intro,
                start: this.h1_start,
                count: this.h1_count
            };
        }

        if (this.h2_id != null) {
            this.section = {
                id: this.h2_id,
                h2: this.h2,
                title_en: this.h2_title_en,
                title: this.h2_title,
                intro_en: this.h2_intro_en,
                intro: this.h2_intro,
                start: this.h2_start
            };
        }

        if (row.prev)
            this.prev = new Hadith(row.prev);
        if (row.next)
            this.next = new Hadith(row.next);
    }

    static async a_dbHadithInit(hadith) {
        // if (!hadith.tags) {
        //     hadith.tags = [];
        //     var tagIds = await a_dbGetTagIds(hadith.id);
        //     for (var tagId in tagIds) {
        //         hadith.tags.push(global.books.find(function (value) {
        //             return tagId == value.id;
        //         }));
        //     }
        // }
        if (!hadith.chapter || !hadith.section) {
            var heading = await a_dbGetHeading(hadith);
            hadith.chapter = heading.chapter;
            hadith.section = heading.section;
        }
        if (hadith.prevId && !hadith.prev) {
            hadith.prev = new Hadith(await a_dbGetHadith(hadith.prevId));
        }
        if (hadith.nextId && !hadith.next) {
            hadith.next = new Hadith(await a_dbGetHadith(hadith.nextId));
        }
    }

    static async a_dbGetRecentUpdates() {
        var results = [];
        var rows = await global.query(
            `SELECT vh.* FROM hadiths h, v_hadiths vh
            WHERE h.highlight IS NOT NULL
              AND h.id = vh.hId
            ORDER BY vh.highlight DESC
            LIMIT 50`);
        for (var i = 0; i < rows.length; i++)
            results.push(new Hadith(rows[i]));
        return results;
    }

    static async a_dbGetTranslationRequests() {
        var results = [];
        var rows = await global.query(
            `SELECT vh.*, h.requested, h.lastmod FROM hadiths h, v_hadiths vh
            WHERE h.requested > 0
              AND h.id = vh.hId
            ORDER BY h.requested DESC, h.lastmod
            LIMIT 50`);
        for (var i = 0; i < rows.length; i++)
            results.push(new Hadith(rows[i]));
        return results;
    }

    static async a_dbGetAllHadithsWithTag(tagId, offset) {
        var results = [];
        var rows = await global.query(`
            SELECT vh.* FROM hadiths_tags ht, v_hadiths vh
            WHERE ht.hadithId=vh.hId AND ht.tagId=${tagId}
            ORDER BY book_id, h1, h2
            LIMIT ${offset},${global.MAX_PER_PAGE + 1}`);
        for (var i = 0; i < rows.length; i++)
            results.push(new Hadith(rows[i]));
        return results;
    }

    static async a_parseNarrators(hadith) {
        console.log(`updating narrators for ${hadith.bookId}:${hadith.num0}`);
        await global.query(`DELETE FROM hadiths_narrs WHERE hadithId=${hadith.id}`);
        var chains_en = Hadith.translateNarrators(hadith.chain).narrators;
        var chains = Hadith.parseNarrators(hadith.chain);
        var inserts = '';
        for (var j = 0; j < chains.length; j++) {
            if (j > 0) inserts += ' , ';
            var narrs_en = [].concat(chains_en[j]).reverse();
            var narrs = [].concat(chains[j]).reverse();
            if (narrs_en.length != narrs.length)
                throw new Error(`ERROR: ${hadith.bookId}:${hadith.num0} has dissimilar narrators`);
            for (var k = 0; k < narrs.length; k++) {
                if (k > 0) inserts += ' , ';
                inserts += ` ( ${hadith.id}, ${j + 1}, ${k + 1}, '${narrs_en[k]}', '${narrs[k]}' )`;
            }
        }
        inserts = inserts.trim();
        var trans = '';
        for (j = 0; j < chains.length; j++) {
            if (j > 0)
                trans += ' ';
            if (chains.length > 1)
                trans += `[Chain ${j + 1}] `;
            narrs_en = chains_en[j];
            for (var k = 0; k < narrs_en.length; k++) {
                if (k > 0) trans += ' > ';
                trans += narrs_en[k];
            }
        }
        trans = trans.trim();
        if (trans.length > 0)
            await global.query(`UPDATE hadiths SET chain_en='${Utils.escSQL(trans)}' WHERE id=${hadith.id}`);
        if (inserts.length > 0)
            await global.query(`INSERT INTO hadiths_narrs (hadithId, chainNum, ordinal, name_en, name) VALUES ${inserts}`);
    }

    static async a_dbGetSimilarCandidates(id) {
        var results = [];
        var rows = await global.query(`
            SELECT c.rating, vh.* FROM v_hadiths vh, (
                SELECT DISTINCT * FROM (
                    SELECT hadithId2 AS id, 1 AS rating FROM hadiths_sim
                    WHERE hadithId1 = ${id}
                    UNION
                    SELECT hadithId1 AS id, 1 AS rating FROM hadiths_sim
                    WHERE hadithId2 = ${id}
                    UNION
                    SELECT hadithId2 AS id, rating FROM hadiths_sim_candidates
                    WHERE hadithId1 = ${id} AND rating >= 0.5
                    UNION
                    SELECT hadithId1 AS id, rating FROM hadiths_sim_candidates
                    WHERE hadithId2 = ${id} AND rating >= 0.5
                ) AS c0
            ) AS c
            WHERE vh.hId = c.id
              AND vh.hId != ${id}
            ORDER BY rating DESC
            LIMIT 50`);
        for (var i = 0; i < rows.length; i++)
            results.push(new Hadith(rows[i]));
        return results;
    }

    static async a_recordSimilarMatches(deHadith, deDB) {
        await global.query(`DELETE FROM hadiths_sim_candidates WHERE hadithId1=${deHadith.id} OR hadithId2=${deHadith.id}`);
        if (!deDB)
            deDB = await Hadith.a_dbGetDisemvoweledHadiths();
        if (deHadith.body && deHadith.body.length < 100 && (
            deHadith.body.match(/????????/) ||
            deHadith.body.match(/????????/) ||
            deHadith.body.match(/??????????????/) ||
            deHadith.back_ref
        )) {
            deDB = null;
            return;
        }
        var inserts = '';
        var matchCnt = 0;
        for (var i = 0; i < deDB.length; i++) {
            if (deHadith.id == deDB[i].id) continue;
            if (Utils.emptyIfNull(deDB[i].body) == '') continue;
            try {
                var match = Hadith.findBestMatch(deHadith, deDB[i]);
                if (match.isMatch) {
                    console.log(`${deHadith.bookId}:${deHadith.num0} ~ ${deDB[i].bookId}:${deDB[i].num0}`);
                    inserts += `${(matchCnt > 0) ? ',' : ''} (${deHadith.id}, ${deDB[i].id}, ${match.bestMatch.rating})`;
                    matchCnt++;
                }
            } catch (err) {
                console.error(`${deHadith.bookId}:${deHadith.num0} ~ ${deDB[i].bookId}:${deDB[i].num0}\t${err}`);
            }
        }
        if (matchCnt > 0)
            await global.query(`INSERT INTO hadiths_sim_candidates (hadithId1, hadithId2, rating) VALUES ${inserts}`);
        deDB = null;
    }

    static findBestMatch(hadith1, hadith2) {
        var source = (hadith1.body.length >= hadith2.body.length) ? hadith2.body : hadith1.body;
        var target = (hadith1.body.length >= hadith2.body.length) ? hadith1.body : hadith2.body;
        var sourceCnt = Utils.wordCount(source);
        var targetCnt = Utils.wordCount(target);
        var match = null;
        if (sourceCnt > 5 && (targetCnt / sourceCnt >= 2)) {
            // var splitLength = Math.floor(target.length / (target.length / source.length));
            // var matches = [];
            // for (var n = 0; n < target.length; n += 30) {
            //     match = stringSimilarity.findBestMatch(source, [target.substring(n, splitLength)]);
            //     matches.push(match);
            // }
            // var best = 0;
            // var bestNdx = 0;
            // for (var i = 0; i < matches.length; i++) {
            //     if (matches[i].bestMatch.rating > best) {
            //         best = matches[i].bestMatch.rating;
            //         bestNdx = i;
            //     }
            // }
            // match = matches[bestNdx];
            // if (match.bestMatch.rating >= 0.55)
            //     match.isMatch = true;
            // else
            //     match.isMatch = false;
            match = stringSimilarity.findBestMatch(source, [target]);
            if (match.bestMatch.rating >= 0.55)
                match.isMatch = true;
            else
                match.isMatch = false;
        } else {
            match = stringSimilarity.findBestMatch(source, [target]);
            if (match.bestMatch.rating >= 0.60)
                match.isMatch = true;
            else
                match.isMatch = false;
        }
        return match;
    }

    static async a_dbGetDisemvoweledHadiths(whereClause) {
        var rows = await global.query(`
            SELECT id, bookId, num0, body, back_ref, lastmod FROM hadiths 
            ${whereClause ? (' WHERE ' + whereClause) : ''}
            ORDER BY bookId, h1, num0`);
        rows = rows.map((row) => {
            return Hadith.disemvoweledHadith(row);
        });
        return rows;
    }

    static async a_reinit() {
        console.error('loading books...');
        global.books = await global.query('SELECT * FROM books ORDER BY id');
        // console.error('loading quran...');
        // global.quran = await global.query('SELECT * FROM v_hadiths WHERE book_id=0 ORDER BY h1, numInChapter');
        // for (var i = 0; i < global.quran.length; i++) {
        //     global.quran[i] = new Hadith(global.quran[i]);
        //     global.quran[i].search_body = Arabic.normalize(Arabic.removeArabicDiacritics(global.quran[i].body));
        // }
        console.error('loading tags...');
        global.tags = await global.query('SELECT * FROM tags');
        console.error('loading grades...');
        global.grades = await global.query('SELECT * FROM grades');
        console.error('loading graders...');
        global.graders = await global.query('SELECT * FROM graders');
        console.error('done loading hadith data');
        console.error('initializing search index');
    }

    static disemvoweledHadith(hadith) {
        if (hadith.body) {
            hadith.body = hadith.body.replace(/????/gu, '');
            hadith.body = hadith.body.replace(/[^\p{L} ]/gu, '');
            hadith.body = hadith.body.replace(/[\u0621\u0671]/gu, '??');
            hadith.body = hadith.body.replace(/[\u0623-\u0626\u0672-\u0678]/gu, '??');
            hadith.body = hadith.body.replace(/[^\u0621-\u064a ]/gu, '');
            if (hadith.bookId > 0) {
                hadith.body = hadith.body.replace(/???????? ???????? /gu, '');
                hadith.body = hadith.body.replace(/(?????????? |??????)/gu, '');
                hadith.body = hadith.body.replace(/?????? ???????? ????.+? /gu, '');
                hadith.body = hadith.body.replace(/???? ???????? ??????.+? /gu, '');
            }
            hadith.body = hadith.body.replace(/( |^)????([^\s]{3,})( |$)/gu, '$1$2$3');
            hadith.body = hadith.body.replace(/( |^)([^\s]{2,})(????|????|????|????)( |$)/gu, '$1$2$4');
            hadith.body = hadith.body.replace(/[????????]/g, '');
            hadith.body = hadith.body.replace(/[??]/g, '??');
            hadith.body = hadith.body.replace(/[????????]/g, '??');
            hadith.body = hadith.body.replace(/ +/gu, ' ');
            hadith.body = hadith.body.trim();
        }
        return hadith;
    }

    static hadithNumtoDecimal(num) {
        if (num.startsWith('i')) {
            num = '0-' + num.substring(1);
        }
        var n = parseInt(Utils.regexExtract(num, /^([0-9]+)/) || -1);
        var d = 0;
        var suffix = Utils.regexExtract(num, /([a-z]+)/);
        if (suffix)
            d = parseInt(Utils.lettersToNumber(suffix)) / 1000.;
        else {
            suffix = Utils.regexExtract(num, /[\-/](\d+)/);
            if (suffix)
                d = parseInt(suffix) / 1000.;
        }
        return n + d;
    }

	static translateNarrators(chain_ar) {
		chain_ar = Arabic.removeDelimeters(chain_ar);
		var chain_en = [];
		var narrators = [];
		var chains = chain_ar.split(/ ?? /);
		for (var i = 0; i < chains.length; i++) {
			var ch = Arabic.toALALC(chains[i]);
			if (chains.length > 1)
				ch = '[Chain] ' + ch;
			ch = ch.replace(/(^| )(wa)????addathan??h /g, ' {$1he-narrated-it-us} ');
			ch = ch.replace(/(^| )(wa)????addathan?? /g, ' {$1he-narrated-us} ');
			ch = ch.replace(/(^| )(wa)????addathan?? /g, ' {$1he-narrated-me} ');
			ch = ch.replace(/(^| )(wa)????addathah?? /g, ' {$1he-narrated-her} ');
			ch = ch.replace(/(^| )(wa)????addathahum /g, ' {$1he-narrated-them} ');
			ch = ch.replace(/(^| )(wa)????addathah /g, ' {$1he-narrated-him} ');
			ch = ch.replace(/(^| )(wa)?(thn??|than??) /g, ' {$1he-narrated-us} ');
			ch = ch.replace(/(^| )(wa??)?akhbaran??h /g, ' {$1he-told-it-us} ');
			ch = ch.replace(/(^| )(wa??)?akhbaran?? /g, ' {$1he-told-us} ');
			ch = ch.replace(/(^| )(wa??)?akhbaran?? /g, ' {$1he-told-me} ');
			ch = ch.replace(/(^| )(wa??)?akhbarah?? /g, ' {$1he-told-her} ');
			ch = ch.replace(/(^| )(wa??)?akhbarahum /g, ' {$1he-told-them} ');
			ch = ch.replace(/(^| )(wa??)?akhbarah /g, ' {$1he-told-him} ');
			ch = ch.replace(/(^| )(wa??)?anba??an??h /g, ' {$1he-informed-it-us} ');
			ch = ch.replace(/(^| )(wa??)?anba??an?? /g, ' {$1he-informed-us} ');
			ch = ch.replace(/(^| )(wa??)?anba??an?? /g, ' {$1he-informed-me} ');
			ch = ch.replace(/(^| )(wa??)?anba??ah?? /g, ' {$1he-informed-her} ');
			ch = ch.replace(/(^| )(wa??)?anba??ahum /g, ' {$1he-informed-them} ');
			ch = ch.replace(/(^| )(wa??)?anba??ah /g, ' {$1he-informed-him} ');
			ch = ch.replace(/(^| )(wa)?nb?? /g, ' {$1he-informed} ');
			ch = ch.replace(/(^| )(wa??)?an?? /g, ' {$1he-informed} ');
			ch = ch.replace(/(^| )(wa??)?n?? /g, ' {$1he-informed} ');
			ch = ch.replace(/(^| )(wa)?n?? /g, ' {$1he-informed} ');

			ch = ch.replace(/(^| )(wa)????addathatn??h /g, ' {$1she-narrated-it-us} ');
			ch = ch.replace(/(^| )(wa)????addathatn?? /g, ' {$1she-narrated-us} ');
			ch = ch.replace(/(^| )(wa)????addathatn?? /g, ' {$1she-narrated-me} ');
			ch = ch.replace(/(^| )(wa)????addathatha /g, ' {$1she-narrated-her} ');
			ch = ch.replace(/(^| )(wa)????addathath /g, ' {$1she-narrated-him} ');
			ch = ch.replace(/(^| )(wa??)?akhbaratn??h /g, ' {$1she-told-it-us} ');
			ch = ch.replace(/(^| )(wa??)?akhbaratn?? /g, ' {$1she-told-us} ');
			ch = ch.replace(/(^| )(wa??)?akhbaratn?? /g, ' {$1she-told-me} ');
			ch = ch.replace(/(^| )(wa??)?akhbarath?? /g, ' {$1she-told-her} ');
			ch = ch.replace(/(^| )(wa??)?akhbarath /g, ' {$1she-told-him} ');
			ch = ch.replace(/(^| )(wa??)?anba??atn??h /g, ' {$1she-informed-itus} ');
			ch = ch.replace(/(^| )(wa??)?anba??atn?? /g, ' {$1she-informed-us} ');
			ch = ch.replace(/(^| )(wa??)?anba??atn?? /g, ' {$1she-informed-me} ');
			ch = ch.replace(/(^| )(wa??)?anba??ath?? /g, ' {$1she-informed-her} ');
			ch = ch.replace(/(^| )(wa??)?anba??ath /g, ' {$1she-informed-him} ');

			ch = ch.replace(/(^| )(wa)?f?? qawl[^ ]+ /g, ' {in-speech} ');
			ch = ch.replace(/(^| )([wf]a)?sami??t /g, ' {I-heard} ');
			ch = ch.replace(/(^| )([wf]a)?sami??at /g, ' {she-heard} ');
			ch = ch.replace(/(^| )([wf]a)?sami??n?? /g, ' {we-heard} ');
			ch = ch.replace(/(^| )([wf]a)?sami?? /g, ' {he-heard} ');

			ch = ch.replace(/(^| )(wa??)?h?? /g, ' {and-he-is} ');
			ch = ch.replace(/(^| )(wa??)?hiy?? /g, ' {and-she-is} ');
			ch = ch.replace(/(^| )(wa??)?hum /g, ' {and-they-are} ');
			ch = ch.replace(/(^| )(wa??)?hum?? /g, ' {and-they-are} ');
			ch = ch.replace(/(^| )(wa??)?il?? /g, ' {to} ');
			ch = ch.replace(/(^| )(a)???al?? /g, ' {on} ');
			ch = ch.replace(/(^| )(wa)???a?n /g, ' {from} ');
			ch = ch.replace(/(^| )(wa??)?annah?? /g, ' {that-she} ');
			ch = ch.replace(/(^| )(wa??)?annah /g, ' {that-he} ');
			ch = ch.replace(/(^| )(wa??)?an+ /g, ' {that} ');

			ch = ch.replace(/(^| )([wf]a)?q??lat\b/g, ' {she-said} ');
			ch = ch.replace(/(^| )([wf]a)?q??l?? /g, ' {both-said} ');
			ch = ch.replace(/(^| )([wf]a)?q??l\b/g, ' {he-said} ');
			ch = ch.replace(/(^| )([wf]a)?qult\b/g, ' {I-said} ');
			ch = ch.replace(/(^| )([wf]a)?yaq??l\b/g, ' {he-says} ');
			ch = ch.replace(/(^| )([wf]a)?taq??l\b/g, ' {she-says} ');

			ch = ch.replace(/{ /g, '{');
			ch = ch.replace(/ kil??hum?? /g, ' {both} ');
			ch = ch.replace(/ wa/, ' and ');
			ch = ch.replace(/ and (qq?????|k????)/, ' wa$1');
			ch = ch.replace(/(^| )(wa?)?na???wah/g, ' {similar-to-it} ');
			ch = ch.replace(/(^| )(wa?)?mithlah/g, ' {similar-to-it} ');

			var matches = ch.matchAll(/\}(.+?)(\{|$)/g);
			var narr = [];
			for (var match of matches) {
				if (!match[1].match(/^\s+$/)) {
					var name = match[1].trim();
					name = name.replace(/[\ufdfa\u0610-\u0613]/g, '');
					name = titleCaseName(match[1].trim());
					name = name.replace(/^Jadd[uai]h??$/ig, 'her father');
					name = name.replace(/^Jadd[uai]h$/ig, 'his father');
					name = name.replace(/^Jadd[ua??]$/ig, 'my father');
					name = name.replace(/^Ab[??????]h??$/ig, 'her father');
					name = name.replace(/^Ab[??????]h$/ig, 'his father');
					name = name.replace(/^Ab[????]$/ig, 'my father');
					name = name.replace(/^Umm[uai]h??$/ig, 'her mother');
					name = name.replace(/^Umm[uai]h$/ig, 'his mother');
					name = name.replace(/^Umm??$/ig, 'my mother');
					name = name.replace(/^??Amm[ua]h??$/ig, 'her uncle');
					name = name.replace(/^??Amm[ua]h$/ig, 'his uncle');
					name = name.replace(/^??Amm??$/ig, 'my uncle');
					name = name.replace(/^Kh??l[uia]h??$/ig, 'her uncle');
					name = name.replace(/^??Kh??l[ua]h$/ig, 'his uncle');
					name = name.replace(/^??Kh??l??$/ig, 'my uncle');
					name = name.replace(/^??Ammat[uia]h??$/ig, 'her aunt');
					name = name.replace(/^??Ammat[uia]h$/ig, 'his aunt');
					name = name.replace(/^??Ammat??$/ig, 'my aunt');
					name = name.replace(/^Kh??lat[uia]h??$/ig, 'her uncle');
					name = name.replace(/^??Kh??lat[ua]h$/ig, 'his uncle');
					name = name.replace(/^??Kh??lat??$/ig, 'my uncle');
					name = name.replace(/Um+ al-Mu??min??n/, '');
					name = name.replace(/Zawj al-Nab??$/, '');
					name = name.replace(/Rajul??n/g, 'two men');
					name = name.replace(/Rajul/g, 'a man');
					name = name.replace(/Mawl??/g, 'a freed slave of');
					name = name.replace(/J??r/g, 'a neighbor');
					name = name.replace(/Ba????? A????????b[ui]h/g, 'some companions');
					name = name.replace(/(Ya??n??|(And )?H??)/, ' / ');
					narr.push(name.trim());
					ch = ch.replace(match[1], ` ${name} `);
				}
			}

			for (var r = 0; r < 3; r++) {
				ch = ch.replace(/{(\w+?)-narrated-(\w+?)}(.+?)({|,|$)/g, '; $3 narrated to $2; $4');
				ch = ch.replace(/{(\w+?)-narrated-it-(\w+?)}(.+?)({|,|$)/g, '; $3 narrated it to $2; $4');
			}
			for (r = 0; r < 3; r++) {
				ch = ch.replace(/{(\w+?)-told-(\w+?)}(.+?)({|,|$)/g, '; $3 told $2; $4');
				ch = ch.replace(/{(\w+?)-told-it-(\w+?)}(.+?)({|,|$)/g, '; $3 told $2 about it; $4');
			}
			for (r = 0; r < 3; r++) {
				ch = ch.replace(/{(\w+?)-informed-(\w+?)}(.+?)({|,|$)/g, '; $3 informed $2; $4');
				ch = ch.replace(/{(\w+?)-informed-it-(\w+?)}(.+?)({|,|$)/g, '; $3 informed $2 about it; $4');
			}
			for (r = 0; r < 3; r++) {
				ch = ch.replace(/{(\w+?)-said}(.+?)({|,|$)/g, 'and $2 said $3');
				ch = ch.replace(/{(\w+?)-heard}(.+?)({|,|$)/g, ' $2 heard $3');
			}
			ch = ch.replace(/{from}/g, '; from ');
			ch = ch.replace(/{that}/g, ' that ');
			ch = ch.replace(/{that-(\w+?)}/g, 'that $1 ');
			ch = ch.replace(/{on}/g, ' on ');
			ch = ch.replace(/{to}/g, ' to ');
			ch = ch.replace(/{both}/g, ' both ');
			ch = ch.replace(/Ab[????]h/g, 'his father');
			ch = ch.replace(/Ab[????]/g, 'my father');
			ch = ch.replace(/\s+/g, ' ');
			ch = ch.replace(/ ;/g, ';');
			ch = ch.replace(/;+/g, ';');
			ch = ch.replace(/^; /, '');
			chain_en.push(ch.trim());
			narrators.push(narr);
		}
		return {
			chain_en: chain_en,
			narrators: narrators
		};
	}

	static parseNarrators(chain_ar) {
		chain_ar = Arabic.removeDelimeters(chain_ar);
		chain_ar = Arabic.normalizeArabicDiacritics(chain_ar);
		var narrators = [];
		var chains = chain_ar.split(/ ?? /);
		for (var i = 0; i < chains.length; i++) {
			var ch = chain_ar;
			if (i > 1)
				ch = ' (??????????????) ' + ch;
			ch = ch.replace(/(^| )(??\u064e)?????????????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)?????????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)?????????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)?????????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)???????????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)???????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)???????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)???????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)???????????????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)???????????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)???????????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)???????????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)?????????????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)?????????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)???????????????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)???????????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)???????????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)???????????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)?????????????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)?????????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)?????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)???????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)???????/g, ' {} ');

			ch = ch.replace(/(^| )(??\u064e)?????????????????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)?????????????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)?????????????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)?????????????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)???????????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)???????????????????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)???????????????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)???????????????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)???????????????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)?????????????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)???????????????????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)???????????????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)???????????????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)???????????????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)?????????????????????????/g, ' {} ');

			ch = ch.replace(/(^| )(??\u064e)?????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)???????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)?????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)?????????????/g, ' {} ');

			ch = ch.replace(/(^| )(??\u064e)???????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)???????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)???????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)?????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)???????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)?????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)?????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)???????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)?????????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)???????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)?????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)???????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)?????????/g, ' {} ');

			ch = ch.replace(/(^| )([????]\u064e)???????????????/g, ' {} ');
			ch = ch.replace(/(^| )([????]\u064e)?????????????/g, ' {} ');
			ch = ch.replace(/(^| )([????]\u064e)???????????/g, ' {} ');
			ch = ch.replace(/(^| )([????]\u064e)?????????????/g, ' {} ');
			ch = ch.replace(/(^| )([????]\u064e)???????????????/g, ' {} ');
			ch = ch.replace(/(^| )([????]\u064e)???????????????/g, ' {} ');

			ch = ch.replace(/(^| )(??\u064e)?????????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)?????????????????/g, ' {} ');
			ch = ch.replace(/(^| )(??\u064e)?????????????????/g, ' {} ');

			ch = ch.replace(/ +/g, ' ');

			var matches = ch.matchAll(/\}(.+?)(\{|$)/g);
			var narr = [];
			for (var match of matches) {
				if (!match[1].match(/^\s+$/)) {
					var name = match[1].trim();
					name = name.replace(/[\ufdfa\u0610-\u0613]/g, '');
					narr.push(name.trim());
				}
			}
			narrators.push(narr);
        }
        
		return narrators;
	}

    static splitHadithText(hadithText) {
        try {
            hadithText.text = Utils.emptyIfNull(hadithText.text);
            hadithText.text = Arabic.removeDelimeters(hadithText.text).trim();
            hadithText.text = hadithText.text.replace(/\s+/g, ' ').trim();
            hadithText.text = Arabic.normalizeArabicDiacritics(hadithText.text);
            var textMarked = Utils.emptyIfNull(hadithText.text);
            textMarked = Arabic.removeArabicDiacritics(textMarked);
            var bodyMarked = '';

            textMarked = textMarked.replaceAll('?????? ???????? ???????? ????????', '???');
            textMarked = textMarked.replaceAll('?????? ???????? ?????????? ???????? ????????', '???');
            textMarked = textMarked.replaceAll('????[????] ???????? ??????(??|????|??)?', '');

            textMarked = textMarked.replace(/[????]?(??????????|??????????|????????????|????????|??????|????????) /g, '~ ');
            textMarked = textMarked.replace(/[????]?(????????????|??????????????|????????????|??????????|????????) /g, '~ ');
            textMarked = textMarked.replace(/[????]?(????????????|??????????????|????????????|??????????|????????|??????) /g, '~ ');
            textMarked = textMarked.replace(/[????]?(??????????|????????????|??????????????|????????) /g, '~ ');
            textMarked = textMarked.replace(/[????]?(????????|??????????|????????????|??????) /g, '~ ');
            textMarked = textMarked.replace(/[????]?(????????|????????) /g, '~ ');
            textMarked = textMarked.replace(/(????) /g, '~ ');
            textMarked = textMarked.replace(/(???????? ????) /g, '~~ ');
            textMarked = textMarked.replace(/(??????|????|????????) /g, '~ ');
            textMarked = textMarked.replace(/(??????|????????|????????|????????|????????) /g, '~ ');
            textMarked = textMarked.replace(/\s+/g, ' ').trim();
            // extract body
            var chainDelims = textMarked.split(/~/);
            if (chainDelims) {
                var chainToksWordCount = [];
                for (var tok of chainDelims)
                    chainToksWordCount.push(wordCount(tok));
                var maxLen = Math.floor(Math.max(...chainToksWordCount) * .25);
                if (maxLen < 10) maxLen = 10;
                for (var j = 0; j < chainDelims.length; j++) {
                    if (chainDelims[j].match(/(??????????|????????|????|??????|??????|??????|????????|????????|??????|????????|??????|????????|??????) /)) {
                        bodyMarked = chainDelims.slice(j).join('~ ');
                        break;
                    } else if (chainToksWordCount[j] > maxLen && !chainDelims[j].match(/ (????|??????) /)) {
                        bodyMarked = chainDelims.slice(j).join('~ ');
                        break;
                    }
                }
                if (bodyMarked == '')
                    bodyMarked = chainDelims[chainDelims.length - 1];
            }
            if (bodyMarked == null) {
                console.log('ERROR on: ' + hadithText.bookId + ' ' + hadithText.num + '\n');
                return;
            }
            bodyMarked = bodyMarked.replace(/\s+/g, ' ').trim();
            // extract chain and body
            var textToks = hadithText.text.split(/ /);
            var textMarkedToks = textMarked.split(/ /);
            var bodyMarkedToks = bodyMarked.split(/ /);
            hadithText.body = '';
            if (!textToks || !bodyMarkedToks || textToks.length == bodyMarkedToks.length)
                hadithText.body = hadithText.text;
            else {
                var diff = textToks.length - bodyMarkedToks.length;
                for (var j = (diff - 1); j >= 0; j--) {
                    if (textMarkedToks[j].endsWith('~'))
                        diff--;
                    else
                        break;
                }
                hadithText.chain = textToks.slice(0, diff).join(' ').trim();
                hadithText.body = textToks.slice(diff).join(' ').trim();
            }
        } catch (err) {
            console.log(`ERROR on: ${hadithText.bookId}:${hadithText.num}: ${err}\n${err.stack}`);
        }
        return hadithText;
    }

    static async reinit() {
        console.log('stubbed out');
    }

}

module.exports = Hadith;

function wordCount(s) {
    return s.split(' ').length;
}

async function a_dbGetHadith(id) {
    var hadith = await global.query(`
        SELECT * FROM v_hadiths
        WHERE hId=${id}`);
    return hadith;
}

function titleCaseName(name) {
	var words = name.split(/([ \-])/);
	for (var w = 0; w < words.length; w++) {
		var word = words[w].split('');
		var i = 0;
		if (word[0] == '??' || word[0] == '??')
			i = 1;
		if (word.length > 1)
			word[i] = word[i].toUpperCase();
		words[w] = word.join('');
	}
	name = words.join('');
	name = name.replace(/Al-/g, 'al-');
	name = name.replace(/B\./g, 'b.');
	return name;
}

// async function a_dbGetTagIds(id) {
//     var tagIds = await global.query(`
//         SELECT tagId FROM hadiths_tags
//         WHERE hadithId=${id}`);
//     return tagIds;
// }

async function a_dbGetHeading(hadith) {
    var heading = {};
    if (hadith.h1 != undefined) {
        var sql = Utils.sql(`
        SELECT * FROM toc
        WHERE bookId=${hadith.bookId} AND level=1 AND h1=${hadith.h1}
        ORDER BY h1,h2,h3 ASC
        LIMIT 1`);
        var results = await global.query(sql);
        heading.chapter = results.find(function (row) {
            if (row.level == 1)
                return true;
        });
    }
    if (hadith.h1 != undefined && hadith.h2 != undefined) {
        var sql = Utils.sql(`
        SELECT * FROM toc
        WHERE bookId=${hadith.bookId} AND level=2 AND h1=${hadith.h1} AND h2=${hadith.h2}
        ORDER BY h1,h2,h3 ASC
        LIMIT 1`);
        var results = await global.query(sql);
        heading.section = results.find(function (row) {
            if (row.level == 2)
                return true;
        });
    }
    return heading;
}

