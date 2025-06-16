type Service = {
    id: number;
    name: string;
};

const INITIAL_SERVICES: Service[] = [
    { id: 1, name: 'Plumbing' },
    { id: 2, name: 'Electrician'},
    { id: 3, name: 'Painting'},
    { id: 4, name: 'Mechanic'},
    { id: 5, name: 'Carpenter'},
    { id: 6, name: 'Cleaning'}
];

export function stringToNumberConversion({
    serviceType 
}: { serviceType: string}) : number {
    return INITIAL_SERVICES.find((s) => s.name === serviceType)?.id || 0
}