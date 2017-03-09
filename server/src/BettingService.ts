import {CronJob} from "cron";
import {LoginService} from "./LoginService";
import {Request} from "./Request";
import {paths} from "../paths";
import {IFacetedQuery} from "./models/Faceted";
import IPromise = Axios.IPromise;
import * as logger from "morgan";
import {IERO} from "./models/ERO";
import {ILBR} from "./models/LBR";
import {BettingRules} from "./BettingRules";
import {IEventTimeLine} from "./models/EventTimeLine";
import {IETXPlaceBet} from "./models/ETX";
import {Helper} from "./Helper";
import {MongoService} from "./MongoService";

export class BettingService {
    private loginService: LoginService;
    private cron: CronJob;
    private cronExpression: string = "20,40,60 * * * * *";
    private mongoService: MongoService;

    constructor() {
        console.log("BettingService started!");
    }

    public init(): void {
        this.loginService = new LoginService();

        this.loginService.startAuthentication().then(() => {
            this.mongoService = new MongoService();
            this.cron = new CronJob(this.cronExpression, this.work.bind(this), null, true);
            // this.work();
        }).catch((error: string) => {
            console.error(error);
        });
        console.log("work done");
    }

    private work(): void {
        try {
            let request = Request.getInstance();
            let facetedQuery: IFacetedQuery = Helper.getFacetedQuery();

            Promise.resolve()
                .then(() => request.post(paths.urlFacet, facetedQuery))
                .then(this.extractFacetedIds)
                .then(this.requestMarketData)
                .then(this.getEventTimeLine)
                .then(this.mergeAllData)
                .then(this.saveMarkets.bind(this))
                .then(this.filterWithBettingRules)
                .then(this.bet)
                .then((d) => console.log(d))
                .catch(error => console.log(error));
        } catch (error) {
            console.error(JSON.stringify(error));
        }
    }

    private bet(bets: Array<Array<IETXPlaceBet>>): string {
        if (bets === null) {
            return "No markets to bet";
        }

        let request = Request.getInstance();

        bets.forEach(bet => {
            console.log(JSON.stringify(bet));
            request.post(paths.urlETX, bet);
        });
        return "done";
    }

    private filterWithBettingRules(data: any): Array<Array<IETXPlaceBet>> {
        if (data === null) {
            return null;
        }

        let bettingRules: BettingRules = new BettingRules();
        return bettingRules.filterMarkets(data.markets, data.wallet);
    }

    private saveMarkets(data: any): any {
        if (data === null) {
            return null;
        }

        if (process.env.SAVE_MONGO) {
            this.mongoService.saveMarket(data.markets)
        }

        return {
            markets: data.markets,
            wallet: data.wallet
        };
    }

    private mergeAllData(values: Array<any>): any {
        if (values === null) {
            return null;
        }

        let ero: IERO = values[0];
        let lbr: Array<ILBR> = values[1];
        let wallet: IWallet = values[2];
        let eventTimeLine: Map<number, IEventTimeLine> = new Map<number, IEventTimeLine>();

        for (let i = 3; i < values.length; i++) {
            let e: IEventTimeLine = values[i].data;
            eventTimeLine.set(e.eventId, e);
        }

        return {
            markets: Helper.mergeDataObjects(ero, lbr, eventTimeLine),
            wallet: wallet
        };
    }

    private getEventTimeLine(values: Array<any>): any {
        if (values === null) {
            return null;
        }

        let ero: IERO = values[0].data;
        let lbr: Array<ILBR> = values[1].data;
        let wallet: IWallet = values[2].data[0];
        let request = Request.getInstance();

        console.log("Cash: " + wallet.details.amount);

        let eventTimeLine: Array<IPromise<any>> = [];
        eventTimeLine.push(Promise.resolve(ero), Promise.resolve(lbr), Promise.resolve(wallet));

        ero.eventTypes.forEach(eventType => {
            eventType.eventNodes.forEach(event => {
                eventTimeLine.push(request.get(paths.getTimeLine(event.eventId)));
            })
        });

        return Promise.all(eventTimeLine);
    }

    private requestMarketData(markets: Array<any>): Promise<Array<any>> {
        let request = Request.getInstance();

        console.log("Found " + markets.length + " inplay markets");

        if (markets.length === 0) {
            return null;
        }

        let ero: IPromise<any> = request.get(paths.getERO(markets));
        let lbr: IPromise<any> = request.get(paths.getLBR(markets));
        let wallet: IPromise<any> = request.get(paths.urlWallet);

        return Promise.all([ero, lbr, wallet]);
    }

    private extractFacetedIds(facetedData: any): Array<string> {
        return facetedData.data.results.map((market: any) => market.marketId);
    }

}