"use client";
import { useState } from "react";

export function SwapUI( { market }: {market:string}){
    const [amount, setAmount] = useState('');
    const [activeTab, setActiveTab] = useState('buy');
    const [ type, setType] = useState('limit');

    return <div>
        <div className="flex flex-col">
            <BuyButton activeTab={activeTab} setActiveTab={setActiveTab}/>
            <SellButton activeTab={activeTab} setActiveTab={setActiveTab}/>
        </div>
        <div className="felx flex-col gap-1">
            <div className="px-3">
                <div className="flex flex-row flex-0 gap-5 undefined">
                    <LimitButton type={type} setType={setType}/>
                    <MarketButton type={type} setType={setType}/>
                </div>
            </div>
            <div className="flex flex-col px-3">
                <div className="flex flex-col flex-1 gap-3 text-baseTextHighEmphasis">
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between flex-row ">
                            <p className="text-xs font-normal text-baseTextMedEmphasis">Available Balance</p>
                            < p className="font-medium text-xs text-baseTextHighEmphasis"> 36.94 USDC</p>
                        </div>
                    </div>
                    <div className="flex flex-col gap-2">
                        <p className="text-xs font-normal text-baseTextMedEmphasis">
                            Price
                        </p>
                        <div className=" flex flex-col relative">
                                <input step="0.01" placeholder="0" className="h-12 rounded-lg border-2 border-solid border-baseBorderLight bg-[var(--background)] pr-12 text-right text-2xl leading-9 text-[$text] placeholder-baseTextMedEmphasis ring-0 transition focus:border-accentBlue focus:ring-0" type="text" value="134.38" />
    
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>


}